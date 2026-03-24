/**
 * Infrastructure Gate — The Alexei Gate
 * ======================================
 *
 * Verifies infrastructure state predicates against parsed state files
 * (Terraform, Pulumi, CloudFormation). No cloud credentials needed —
 * pure JSON parsing against local state files and manifests.
 *
 * Three predicate types:
 *   infra_resource  — Does a named resource exist in the state file?
 *   infra_attribute — Does a resource have a specific tag/property value?
 *   infra_manifest  — Does the current state match a known-good manifest?
 *
 * This gate could have stopped the Alexei disaster.
 * Not with a fancier model. With a predicate.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type {
  GateContext, GateResult, Predicate, PredicateResult,
  InfraStateContext, InfraResource, InfraManifest,
} from '../types.js';

// =============================================================================
// STATE FILE PARSING
// =============================================================================

/**
 * Parse a Terraform v4 state file into a flat resource list.
 * Supports nested attributes via dot-notation flattening.
 */
export function parseTerraformState(raw: string): InfraStateContext {
  const state = JSON.parse(raw);
  const resources: InfraResource[] = [];

  for (const res of state.resources ?? []) {
    const address = `${res.type}.${res.name}`;
    for (const instance of res.instances ?? []) {
      const attrs = instance.attributes ?? {};
      const flat = flattenAttributes(attrs);
      resources.push({
        address,
        type: res.type,
        id: flat.id as string ?? flat.identifier as string ?? address,
        attributes: flat,
      });
    }
  }

  return {
    resources,
    version: state.version,
    toolVersion: state.terraform_version,
  };
}

/**
 * Flatten nested objects into dot-notation keys.
 * { tags: { Environment: "prod" } } → { "tags.Environment": "prod", tags: {...} }
 */
export function flattenAttributes(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    result[fullKey] = value;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenAttributes(value as Record<string, unknown>, fullKey));
    }
  }

  return result;
}

/**
 * Find and parse a state file from a directory.
 * Searches for terraform.tfstate, pulumi.state.json, etc.
 */
export function findAndParseState(infraDir: string): InfraStateContext | undefined {
  const candidates = [
    'terraform.tfstate',
    'terraform.tfstate.backup',
    'pulumi.state.json',
  ];

  for (const name of candidates) {
    const filePath = join(infraDir, name);
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        // Detect format by content
        const parsed = JSON.parse(raw);
        if (parsed.version !== undefined && parsed.resources) {
          return parseTerraformState(raw);
        }
        // Could add Pulumi parsing here in the future
      } catch { /* invalid JSON — skip */ }
    }
  }

  return undefined;
}

/**
 * Load a manifest file (known-good baseline).
 */
export function loadManifest(infraDir: string, fileName = 'manifest.json'): InfraManifest | undefined {
  const filePath = join(infraDir, fileName);
  if (!existsSync(filePath)) return undefined;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch { return undefined; }
}

// =============================================================================
// RESOURCE LOOKUP
// =============================================================================

/**
 * Find a resource by address in the parsed state.
 * Address format: "type.name" (e.g., "aws_db_instance.production")
 */
export function findResource(
  state: InfraStateContext,
  address: string,
): InfraResource | undefined {
  return state.resources.find(r => r.address === address);
}

/**
 * Get a nested attribute value using dot notation.
 * "tags.Environment" → resource.attributes["tags.Environment"]
 */
export function getAttribute(
  resource: InfraResource,
  attributePath: string,
): unknown {
  // Direct flat lookup first (handles pre-flattened attrs)
  if (attributePath in resource.attributes) {
    return resource.attributes[attributePath];
  }

  // Traverse nested structure
  const parts = attributePath.split('.');
  let current: unknown = resource.attributes;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Count resources that would be affected by a destroy targeting a set of addresses.
 * Includes resources that depend on the targeted resources (via VPC ID, cluster, etc.).
 */
export function countDependents(
  state: InfraStateContext,
  targetAddresses: string[],
): { directCount: number; dependentCount: number; dependents: string[] } {
  const targetIds = new Set<string>();
  for (const addr of targetAddresses) {
    const res = findResource(state, addr);
    if (res) targetIds.add(String(res.attributes.id ?? ''));
  }

  const dependents: string[] = [];
  for (const res of state.resources) {
    if (targetAddresses.includes(res.address)) continue;
    // Check if any attribute references a target ID (vpc_id, cluster, etc.)
    for (const [key, value] of Object.entries(res.attributes)) {
      if (typeof value === 'string' && targetIds.has(value) &&
          (key.endsWith('_id') || key === 'cluster' || key === 'vpc_id')) {
        dependents.push(res.address);
        break;
      }
    }
  }

  return {
    directCount: targetAddresses.length,
    dependentCount: dependents.length,
    dependents,
  };
}

// =============================================================================
// MANIFEST COMPARISON
// =============================================================================

/**
 * Compare current state against a known-good manifest.
 * Returns list of drifts found.
 */
export function compareManifest(
  state: InfraStateContext,
  manifest: InfraManifest,
): ManifestDrift[] {
  const drifts: ManifestDrift[] = [];

  for (const expected of manifest.resources) {
    const actual = findResource(state, expected.address);

    if (!actual) {
      drifts.push({
        address: expected.address,
        type: 'missing',
        critical: expected.critical,
        detail: `Resource ${expected.address} exists in manifest but not in state`,
      });
      continue;
    }

    // Compare critical attributes
    for (const [attrPath, expectedValue] of Object.entries(expected.attributes)) {
      const actualValue = getAttribute(actual, attrPath);
      const actualStr = String(actualValue ?? '');
      const expectedStr = String(expectedValue);

      if (actualStr !== expectedStr) {
        drifts.push({
          address: expected.address,
          type: 'attribute_drift',
          critical: expected.critical,
          detail: `${expected.address}.${attrPath}: expected "${expectedStr}", got "${actualStr}"`,
          attribute: attrPath,
          expected: expectedStr,
          actual: actualStr,
        });
      }
    }
  }

  // Check for resources in state but not in manifest (orphans)
  for (const res of state.resources) {
    const inManifest = manifest.resources.some(m => m.address === res.address);
    if (!inManifest) {
      drifts.push({
        address: res.address,
        type: 'orphan',
        critical: false,
        detail: `Resource ${res.address} exists in state but not in manifest`,
      });
    }
  }

  return drifts;
}

export interface ManifestDrift {
  address: string;
  type: 'missing' | 'attribute_drift' | 'orphan';
  critical: boolean;
  detail: string;
  attribute?: string;
  expected?: string;
  actual?: string;
}

// =============================================================================
// INFRASTRUCTURE GATE
// =============================================================================

/**
 * Run the infrastructure gate — validate infra predicates against parsed state.
 */
export function runInfrastructureGate(ctx: GateContext): GateResult & { predicateResults: PredicateResult[] } {
  const start = Date.now();
  const infraPreds = ctx.predicates.filter(p =>
    p.type === 'infra_resource' || p.type === 'infra_attribute' || p.type === 'infra_manifest'
  );

  if (infraPreds.length === 0) {
    return {
      gate: 'infrastructure' as any,
      passed: true,
      detail: 'No infrastructure predicates to check',
      durationMs: Date.now() - start,
      predicateResults: [],
    };
  }

  const state = ctx.grounding?.infraState;
  if (!state) {
    return {
      gate: 'infrastructure' as any,
      passed: false,
      detail: 'No infrastructure state available (no terraform.tfstate or equivalent found)',
      durationMs: Date.now() - start,
      predicateResults: infraPreds.map((p, i) => ({
        predicateId: `infra_p${i}`,
        type: p.type,
        passed: false,
        expected: describeExpected(p),
        actual: '(no state file)',
        fingerprint: infraPredicateFingerprint(p),
      })),
    };
  }

  // Load manifest if needed for infra_manifest predicates
  let manifest: InfraManifest | undefined;
  const manifestPreds = infraPreds.filter(p => p.type === 'infra_manifest');
  if (manifestPreds.length > 0 && ctx.config.appDir) {
    // Search for manifest in infra dir or app dir
    const infraDir = findInfraDir(ctx.config.appDir);
    if (infraDir) manifest = loadManifest(infraDir);
  }

  const results: PredicateResult[] = [];
  let allPassed = true;
  const details: string[] = [];

  for (let i = 0; i < infraPreds.length; i++) {
    const p = infraPreds[i];
    const result = validateInfraPredicate(p, state, manifest);
    results.push({ ...result, predicateId: `infra_p${i}` });

    if (!result.passed) {
      allPassed = false;
      details.push(`${p.type}: ${result.actual ?? 'failed'}`);
    }
  }

  const passCount = results.filter(r => r.passed).length;
  const detail = allPassed
    ? `All ${infraPreds.length} infrastructure predicates passed`
    : `${passCount}/${infraPreds.length} passed: ${details.join('; ')}`;

  ctx.log(`[infrastructure] ${detail}`);

  return {
    gate: 'infrastructure' as any,
    passed: allPassed,
    detail,
    durationMs: Date.now() - start,
    predicateResults: results,
  };
}

// =============================================================================
// PER-PREDICATE VALIDATION
// =============================================================================

function validateInfraPredicate(
  p: Predicate,
  state: InfraStateContext,
  manifest?: InfraManifest,
): Omit<PredicateResult, 'predicateId'> {
  const fingerprint = infraPredicateFingerprint(p);

  // --- infra_resource: does a resource exist (or not)? ---
  if (p.type === 'infra_resource' && p.resource) {
    const resource = findResource(state, p.resource);
    const assertion = p.assertion ?? 'exists';

    if (assertion === 'exists') {
      return {
        type: 'infra_resource',
        passed: !!resource,
        expected: `${p.resource} exists`,
        actual: resource ? `${p.resource} found (id: ${resource.id})` : `${p.resource} not found`,
        fingerprint,
      };
    }

    if (assertion === 'absent') {
      return {
        type: 'infra_resource',
        passed: !resource,
        expected: `${p.resource} absent`,
        actual: resource ? `${p.resource} still exists (id: ${resource.id})` : `${p.resource} absent`,
        fingerprint,
      };
    }
  }

  // --- infra_attribute: does a resource have a specific attribute value? ---
  if (p.type === 'infra_attribute' && p.resource && p.attribute) {
    const resource = findResource(state, p.resource);

    if (!resource) {
      return {
        type: 'infra_attribute',
        passed: false,
        expected: `${p.resource}.${p.attribute} == ${p.expected}`,
        actual: `resource ${p.resource} not found`,
        fingerprint,
      };
    }

    const actualValue = getAttribute(resource, p.attribute);
    const actualStr = actualValue === undefined ? '(undefined)' : String(actualValue);
    const expectedStr = p.expected ?? 'exists';

    if (expectedStr === 'exists') {
      return {
        type: 'infra_attribute',
        passed: actualValue !== undefined && actualValue !== null,
        expected: `${p.attribute} exists`,
        actual: actualStr,
        fingerprint,
      };
    }

    // String comparison (handles booleans as "true"/"false")
    const passed = actualStr === expectedStr;
    return {
      type: 'infra_attribute',
      passed,
      expected: expectedStr,
      actual: actualStr,
      fingerprint,
    };
  }

  // --- infra_manifest: does current state match manifest? ---
  if (p.type === 'infra_manifest') {
    if (!manifest) {
      return {
        type: 'infra_manifest',
        passed: false,
        expected: 'state matches manifest',
        actual: 'no manifest file found',
        fingerprint,
      };
    }

    const assertion = p.assertion ?? 'matches_manifest';
    const drifts = compareManifest(state, manifest);

    if (assertion === 'matches_manifest') {
      const passed = drifts.length === 0;
      return {
        type: 'infra_manifest',
        passed,
        expected: 'state matches manifest (0 drifts)',
        actual: passed
          ? 'state matches manifest'
          : `${drifts.length} drift(s): ${drifts.slice(0, 3).map(d => d.detail).join('; ')}`,
        fingerprint,
      };
    }

    if (assertion === 'no_production_drift') {
      const criticalDrifts = drifts.filter(d => d.critical);
      const passed = criticalDrifts.length === 0;
      return {
        type: 'infra_manifest',
        passed,
        expected: 'no production-critical drift',
        actual: passed
          ? 'no critical drift'
          : `${criticalDrifts.length} critical drift(s): ${criticalDrifts.slice(0, 3).map(d => d.detail).join('; ')}`,
        fingerprint,
      };
    }
  }

  // Unknown predicate configuration
  return {
    type: p.type,
    passed: false,
    expected: 'valid infrastructure predicate',
    actual: `unrecognized predicate config: type=${p.type}, resource=${p.resource}, assertion=${p.assertion}`,
    fingerprint,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

export function infraPredicateFingerprint(p: Predicate): string {
  const parts = [`type=${p.type}`];
  if (p.resource) parts.push(`resource=${p.resource}`);
  if (p.attribute) parts.push(`attribute=${p.attribute}`);
  if (p.expected) parts.push(`exp=${p.expected}`);
  if (p.assertion) parts.push(`assertion=${p.assertion}`);
  if (p.stateFile) parts.push(`stateFile=${p.stateFile}`);
  return parts.join('|');
}

function describeExpected(p: Predicate): string {
  if (p.type === 'infra_resource') return `${p.resource} ${p.assertion ?? 'exists'}`;
  if (p.type === 'infra_attribute') return `${p.resource}.${p.attribute} == ${p.expected}`;
  if (p.type === 'infra_manifest') return `state ${p.assertion ?? 'matches_manifest'}`;
  return 'infrastructure check';
}

/**
 * Find the infrastructure directory for a given app.
 * Searches appDir itself, then appDir/infra/, appDir/terraform/, etc.
 */
export function findInfraDir(appDir: string): string | undefined {
  // Direct: state file in appDir
  if (existsSync(join(appDir, 'terraform.tfstate'))) return appDir;

  // Subdirectories
  const subdirs = ['infra', 'terraform', 'infrastructure', 'iac'];
  for (const sub of subdirs) {
    const dir = join(appDir, sub);
    if (existsSync(join(dir, 'terraform.tfstate'))) return dir;
    if (existsSync(join(dir, 'manifest.json'))) return dir;
  }

  // Sibling: ../demo-infra (for fixture layout)
  const sibling = join(appDir, '..', 'demo-infra');
  if (existsSync(join(sibling, 'terraform.tfstate'))) return sibling;

  return undefined;
}
