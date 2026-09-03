---
name: writing-tests
description: Guideline on how to write unit, integration and e2e tests
---

Write tests to verify that the feature behaves correctly, not simply to make the test suite green or increase coverage.

Tests should be written by sub agents.

## Principles

- Understand the feature before writing or modifying tests.
- Test meaningful behaviour and externally observable outcomes.
- Every test should protect a real requirement, invariant, edge case, or failure mode.
- Do not add a test merely because code was added or changed.
- Do not test implementation details unless they are themselves part of the required behaviour.
- Do not write tautological tests that reproduce the implementation and therefore cannot meaningfully fail.
- Do not weaken, delete, skip, or rewrite an existing test just to make a change pass unless the expected behaviour has genuinely changed.
- Prefer a small number of strong tests over many superficial ones.
- A green test suite is not the goal. Confidence that the feature works is the goal.

## Before writing a test

Determine:

1. What behaviour is this feature supposed to introduce or preserve?
2. What would constitute a real regression?
3. Which inputs, states, boundaries, or failures matter?
4. Is an existing test already covering this behaviour?

If there is no meaningful behaviour to verify, do not invent a test just to have one.

## When reviewing a test

Ask:

- Would this test fail if the feature were broken in a realistic way?
- Does it verify the intended behaviour rather than the current implementation?
- Is the assertion meaningful, or is it merely proving that the code executed?
- Does the setup represent a plausible state of the system?
- Does the expected result come from the feature requirements rather than copying values from the implementation?
- Would someone reading this test understand what product or system behaviour it protects?

If the answer is no, improve or remove the test.

## Feature changes

When implementing a feature or fixing a bug, derive tests from the behaviour being changed.

For a bug fix, ideally reproduce the bug with a failing test first, then verify that the fix makes it pass.

For a new feature, cover the important successful behaviour and any significant boundaries or failure cases. Do not mechanically add tests for every branch or function unless those branches represent meaningful behaviour.

## Avoid

- Assertions such as `toBeDefined()` when a specific result matters.
- Snapshot tests used only because they are easy to generate.
- Mock-heavy tests that merely verify mocks were called instead of verifying behaviour.
- Tests that duplicate the source code's logic to calculate the expected value.
- Tests added solely for coverage percentage.
- Tests that only confirm constructors, getters, wrappers, or framework behaviour with no meaningful project-specific contract.
- Changing expectations to match broken behaviour without checking whether the feature requirements changed.

A test should exist because there is something worth protecting.
