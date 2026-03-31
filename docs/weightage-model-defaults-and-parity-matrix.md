# Weightage Model Defaults and Parity Matrix

## 1. Objective
This document provides:
- A practical default weight configuration tailored to the current app behavior
- Policy bonuses/penalties to mirror existing recommendation choices
- A 10-scenario parity matrix to test whether a hybrid model reproduces current Track A outcomes

This is a design draft for knowledge and planning, not implementation code.

## 2. Recommended Hybrid Model
Use a two-layer decision engine.

Layer A: Hard gates (must-pass)
- Selected target service only
- Protocol compatibility
- Region availability (with configured fallback transforms)
- Redundancy compatibility (with fallback chain)
- Performance envelope compatibility
- Service-specific constraints (media/tier selection)

Layer B: Weighted ranking for candidates that pass Layer A
- Score each candidate using normalized factors
- Apply optional policy bonuses
- Rank by readiness class first, then score

## 3. Readiness Class Priority
Use class priority before weighted score to preserve current semantics:
1. Ready
2. Ready with Condition
3. Not Ready

Inside same class, use weighted score.

## 4. Default Factor Weights (Global)
All feature scores are normalized to 0..1.

| Factor | Symbol | Default Weight | Why it maps to current app |
|---|---:|---:|---|
| Readiness quality | w_readiness | 0.35 | Current app strongly prioritizes readiness state |
| Protocol fit quality | w_protocol | 0.20 | Protocol path is a primary branch in current logic |
| Performance fit margin | w_perf | 0.15 | Files HDD/SSD selection and constraints are perf-driven |
| Redundancy fit quality | w_redundancy | 0.10 | Downgrade/compatibility is explicit in readiness reasons |
| Region fit quality | w_region | 0.10 | Region gate and fallback are key constraints |
| Cost efficiency proxy | w_cost | 0.10 | Tie-breaking behavior references cost in current UX |

Check: total = 1.00

## 5. Factor Scoring Definitions

### 5.1 Readiness quality score
- Ready = 1.00
- Ready with Condition = 0.65
- Not Ready = 0.00

### 5.2 Protocol fit score
- Native supported path = 1.00
- Supported with adaptation/condition = 0.55
- Unsupported = 0.00

### 5.3 Performance fit margin score (Files-heavy)
Use margins from thresholds where available.
- Comfortable margin = 0.90 to 1.00
- Near threshold = 0.60 to 0.80
- At/over threshold = 0.00

For Blob tiers, use tier-intent fit heuristic:
- Tier aligned with selected access frequency = 1.00
- Adjacent fallback tier = 0.70
- Other tier = 0.40

### 5.4 Redundancy fit score
- Requested redundancy directly supported = 1.00
- Supported via fallback downgrade = 0.70
- Unsupported no fallback = 0.00

### 5.5 Region fit score
- Directly available in selected region = 1.00
- Available via configured fallback transform = 0.70
- Unavailable no fallback = 0.00

### 5.6 Cost efficiency score (proxy)
Use relative service-internal ordering only for tie contexts.
- Files: Standard HDD > Premium SSD (cost efficiency)
- Blob: Archive > Cold > Cool > Hot (cost efficiency)
Map to 0.0..1.0 per service for ranking hints, not as hard constraints.

## 6. Policy Bonuses and Penalties (Track A aligned)

Use additive policy term B(o) after weighted score.

### 6.1 Archive preference policy
- Condition: selected blob access frequency = archive
- Bonus: +0.12 to Blob candidates
- Rationale: mirrors current Track A behavior where archive can boost Blob recommendation

### 6.2 Readiness-maximized alternative policy
- Condition: no candidate in selected service is Ready or Ready with Condition
- Bonus: +0.08 to readiness-maximized alternative candidate
- But keep readiness class as Ready with Condition (never force Ready)

### 6.3 Penalty for heavy adaptation burden
- Condition: protocol/application adaptation reason exists
- Penalty: -0.08
- Rationale: preserves “Ready with Condition” preference below strong native fits

## 7. Suggested Service-Specific Adapter Defaults

### 7.1 Azure Files
- Protocol native: SMB v2/v3, NFS v4.1
- NFS v3-only path: unsupported unless adaptation mode
- Media constraints:
  - If media filter contains only SSD, HDD gets 0 eligibility
  - If media filter contains only HDD, SSD gets 0 eligibility
- Performance adapter:
  - HDD score drops sharply near HDD thresholds
  - SSD score remains high until SSD thresholds

### 7.2 Azure Blob
- Protocol native: S3, NFS v3
- Access frequency strongly influences preferred tier score
- Region adapter supports warmer-tier fallback when selected tier unavailable

### 7.3 Azure NetApp Files (future expansion)
- Keep as profile-only plug-in
- Define region and redundancy support maps
- Add performance and protocol adapters without changing core evaluator

## 8. Score Formula
For candidate outcome o:

Score(o) = sum(w_i * f_i(o)) + Bonus(o) - Penalty(o)

Sort key:
1. readiness class priority (Ready > Ready with Condition > Not Ready)
2. Score descending
3. cost proxy descending (optional deterministic tie breaker)

## 9. 10-Scenario Parity Matrix (Track A)
Use these to compare current app outcome vs hybrid model outcome.

| ID | Input Focus | Expected Current Behavior | Expected Hybrid Behavior for Parity |
|---|---|---|---|
| S1 | Blobs+Files selected, SMB only, normal perf | Files path dominates; Blob blocked or conditional by protocol path | Same readiness classes and top recommendation |
| S2 | Blobs+Files selected, NFS v3 only, non-archive | Blob path should dominate; Files mostly blocked/conditional | Same eligible set and same top Blob tier logic |
| S3 | Blobs+Files selected, NFS v4.1 only | Files should dominate; Blob protocol weak/blocked | Same readiness and recommendation |
| S4 | Blobs selected, access=archive, supported region | Blob archive candidate favored in Track A | Same due to archive policy bonus |
| S5 | Blobs selected, archive in unsupported region | Tier fallback to warmer tier with reason | Same fallback outcome and reason category |
| S6 | Files selected, media=SSD only, perf in SSD range | Premium SSD recommended | Same |
| S7 | Files selected, media=HDD only, perf exceeds HDD but within SSD | HDD not ready; recommendation behavior follows filter/eligibility rules | Same readiness outcomes and selected recommendation |
| S8 | Files selected, selected redundancy unsupported for chosen SKU | Redundancy downgrade applied with condition reason | Same downgrade and readiness class |
| S9 | Mixed protocol SMB + NFS v3 + S3, both services selected | Many outcomes become Ready with Condition with mixed-protocol reasons | Same readiness state distribution and recommendation ordering |
| S10 | Selected service has no Ready/Condition baseline options | Readiness-maximized alternative appears as Ready with Condition | Same trigger condition and alternative selection behavior |

## 10. Parity Acceptance Criteria
A scenario is considered parity-pass when all are true:
- Same top recommended outcome set (single or tie-set)
- Same readiness class for top outcome(s)
- Same fallback transform type when applicable (tier/SKU/redundancy)
- Reason categories match (blocker vs condition), wording can differ

Target threshold:
- 9/10 scenario parity minimum for first calibration pass
- 10/10 before replacing deterministic ranking path

## 11. Fast Calibration Loop
1. Run all 10 scenarios through current app and capture outputs
2. Run hybrid scorer with defaults above
3. Adjust in this order:
   - gate strictness first
   - policy bonuses second
   - global weights third
4. Re-run matrix until parity target met

## 12. Why this scales for new services
To add a new target service, add configuration only:
- service profile
- protocol/redundancy/region maps
- performance adapter
- optional policy knobs

The evaluator and scorer stay unchanged, preventing combination-driven branching growth.
