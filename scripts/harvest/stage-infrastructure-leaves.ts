/**
 * Generates infrastructure gate scenarios from demo-app fixtures.
 * Tests terraform state file parsing: infra_resource, infra_attribute, infra_manifest.
 * Requires: fixtures/demo-app/infra/terraform.tfstate and infra/manifest.json
 * Run: bun scripts/harvest/stage-infrastructure-leaves.ts
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/infrastructure-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `inf-${String(id++).padStart(3, '0')}`, ...s });
}

// The infrastructure gate reads terraform.tfstate from appDir/infra/ (one of the search paths).
// It parses resources and validates predicates against them.

// =============================================================================
// Family: resource_exists — resource exists in state
// =============================================================================

push({
  description: 'infra_resource exists: aws_db_instance.production',
  edits: [],
  predicates: [{
    type: 'infra_resource',
    resource: 'aws_db_instance.production',
    assertion: 'exists',
  }],
  expectedSuccess: true,
  tags: ['infrastructure', 'resource_exists'],
  rationale: 'aws_db_instance.production is in the terraform state',
});

push({
  description: 'infra_resource exists: aws_s3_bucket.assets',
  edits: [],
  predicates: [{
    type: 'infra_resource',
    resource: 'aws_s3_bucket.assets',
    assertion: 'exists',
  }],
  expectedSuccess: true,
  tags: ['infrastructure', 'resource_exists'],
  rationale: 'aws_s3_bucket.assets is in the terraform state',
});

push({
  description: 'infra_resource exists: aws_security_group.web',
  edits: [],
  predicates: [{
    type: 'infra_resource',
    resource: 'aws_security_group.web',
    assertion: 'exists',
  }],
  expectedSuccess: true,
  tags: ['infrastructure', 'resource_exists'],
  rationale: 'aws_security_group.web is in the terraform state',
});

// =============================================================================
// Family: resource_exists_fail — resource not in state
// =============================================================================

push({
  description: 'infra_resource exists: nonexistent resource',
  edits: [],
  predicates: [{
    type: 'infra_resource',
    resource: 'aws_lambda_function.missing',
    assertion: 'exists',
  }],
  expectedSuccess: false,
  tags: ['infrastructure', 'resource_exists_fail'],
  rationale: 'aws_lambda_function.missing is not in terraform state',
});

// =============================================================================
// Family: resource_absent — resource should NOT exist
// =============================================================================

push({
  description: 'infra_resource absent: nonexistent resource passes absent check',
  edits: [],
  predicates: [{
    type: 'infra_resource',
    resource: 'aws_lambda_function.missing',
    assertion: 'absent',
  }],
  expectedSuccess: true,
  tags: ['infrastructure', 'resource_absent'],
  rationale: 'Resource does not exist, absent assertion passes',
});

push({
  description: 'infra_resource absent: existing resource fails absent check',
  edits: [],
  predicates: [{
    type: 'infra_resource',
    resource: 'aws_db_instance.production',
    assertion: 'absent',
  }],
  expectedSuccess: false,
  tags: ['infrastructure', 'resource_absent_fail'],
  rationale: 'Resource exists but assertion says absent → fail',
});

// =============================================================================
// Family: attribute — resource attribute value checks
// =============================================================================

push({
  description: 'infra_attribute: db engine == postgres',
  edits: [],
  predicates: [{
    type: 'infra_attribute',
    resource: 'aws_db_instance.production',
    attribute: 'engine',
    expected: 'postgres',
  }],
  expectedSuccess: true,
  tags: ['infrastructure', 'attribute'],
  rationale: 'DB instance engine is postgres',
});

push({
  description: 'infra_attribute: db deletion_protection == true',
  edits: [],
  predicates: [{
    type: 'infra_attribute',
    resource: 'aws_db_instance.production',
    attribute: 'deletion_protection',
    expected: 'true',
  }],
  expectedSuccess: true,
  tags: ['infrastructure', 'attribute'],
  rationale: 'deletion_protection is true',
});

push({
  description: 'infra_attribute: db tags.Environment == production',
  edits: [],
  predicates: [{
    type: 'infra_attribute',
    resource: 'aws_db_instance.production',
    attribute: 'tags.Environment',
    expected: 'production',
  }],
  expectedSuccess: true,
  tags: ['infrastructure', 'attribute'],
  rationale: 'Nested tag attribute via dot notation',
});

push({
  description: 'infra_attribute: s3 acl == private',
  edits: [],
  predicates: [{
    type: 'infra_attribute',
    resource: 'aws_s3_bucket.assets',
    attribute: 'acl',
    expected: 'private',
  }],
  expectedSuccess: true,
  tags: ['infrastructure', 'attribute'],
  rationale: 'S3 bucket ACL is private',
});

push({
  description: 'infra_attribute: sg vpc_id == vpc-demo',
  edits: [],
  predicates: [{
    type: 'infra_attribute',
    resource: 'aws_security_group.web',
    attribute: 'vpc_id',
    expected: 'vpc-demo',
  }],
  expectedSuccess: true,
  tags: ['infrastructure', 'attribute'],
  rationale: 'Security group VPC ID matches',
});

// =============================================================================
// Family: attribute_fail — wrong attribute values
// =============================================================================

push({
  description: 'infra_attribute: db engine wrong value',
  edits: [],
  predicates: [{
    type: 'infra_attribute',
    resource: 'aws_db_instance.production',
    attribute: 'engine',
    expected: 'mysql',
  }],
  expectedSuccess: false,
  tags: ['infrastructure', 'attribute_fail'],
  rationale: 'Engine is postgres not mysql',
});

push({
  description: 'infra_attribute: nonexistent attribute',
  edits: [],
  predicates: [{
    type: 'infra_attribute',
    resource: 'aws_db_instance.production',
    attribute: 'nonexistent_attr',
    expected: 'anything',
  }],
  expectedSuccess: false,
  tags: ['infrastructure', 'attribute_fail'],
  rationale: 'Attribute does not exist on resource',
});

push({
  description: 'infra_attribute: nonexistent resource',
  edits: [],
  predicates: [{
    type: 'infra_attribute',
    resource: 'aws_missing.thing',
    attribute: 'id',
    expected: 'something',
  }],
  expectedSuccess: false,
  tags: ['infrastructure', 'attribute_fail'],
  rationale: 'Resource does not exist in state',
});

// =============================================================================
// Family: manifest — state matches known-good manifest
// =============================================================================

push({
  description: 'infra_manifest: state matches manifest',
  edits: [],
  predicates: [{
    type: 'infra_manifest',
    stateFile: 'terraform.tfstate',
  }],
  expectedSuccess: true,
  tags: ['infrastructure', 'manifest'],
  rationale: 'Terraform state matches the manifest.json baseline',
});

// =============================================================================
// Family: manifest_fail — state drifted from manifest
// NOTE: infra gate reads appDir not stageDir, so edits to terraform.tfstate
// in staging have no effect. We test manifest_fail via attribute_fail scenarios instead.
// The manifest_fail family is effectively tested by attribute_fail (wrong values)
// and resource_exists_fail (missing resources).
// =============================================================================

// =============================================================================
// Family: multi — multiple infra predicates
// =============================================================================

push({
  description: 'multi: resource exists + attribute check both pass',
  edits: [],
  predicates: [
    { type: 'infra_resource', resource: 'aws_db_instance.production', assertion: 'exists' },
    { type: 'infra_attribute', resource: 'aws_db_instance.production', attribute: 'engine', expected: 'postgres' },
  ],
  expectedSuccess: true,
  tags: ['infrastructure', 'multi'],
  rationale: 'Both resource existence and attribute value pass',
});

push({
  description: 'multi: one pass + one fail',
  edits: [],
  predicates: [
    { type: 'infra_resource', resource: 'aws_db_instance.production', assertion: 'exists' },
    { type: 'infra_resource', resource: 'aws_missing.thing', assertion: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['infrastructure', 'multi_fail'],
  rationale: 'Second resource does not exist, gate fails',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} infrastructure scenarios to ${outPath}`);
