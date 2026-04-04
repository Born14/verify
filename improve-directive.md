# Improve Directive

<!-- 
  This file guides the autonomous improvement loop's priorities.
  Inspired by AutoAgent's program.md pattern — program the meta-agent
  through a directive file rather than editing TypeScript.

  The improve loop reads this file and injects its contents into
  LLM diagnosis and fix generation prompts.

  Usage: bun scripts/self-test.ts --improve --llm=claude --directive=improve-directive.md
-->

<!-- Uncomment and customize the fields below: -->

<!-- priority-gates: security, grounding, http -->
<!-- focus: all -->
<!-- edit-style: minimal -->

## Custom Instructions

<!-- Add domain-specific guidance for the improvement engine here.
     Examples:

     When fixing security gate false positives, prefer tightening the
     detection regex over adding new special cases.

     For grounding gate improvements, ensure CSS normalization handles
     modern CSS features (oklch, container queries, :has()).

     The HTTP gate should be strict about status codes but lenient
     about response body matching (partial matches OK).
-->
