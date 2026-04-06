## Peer Review — *Mozg: A "Slow by Design" Federated Query Layer for Heterogeneous Data Sources via GraphQL*

> **Review conducted following the Wiley step-by-step guide for peer review.**
> Reviewer: GitHub Copilot (AI-assisted review, disclosed)
> Manuscript: `paper/mozg.tex`

---

### Summary

The paper presents Mozg, an open-source federated query layer that exposes a single GraphQL endpoint capable of routing queries to multiple heterogeneous data sources (relational databases, graph databases, REST services, OWL-backed stores). The system deliberately avoids caching or centralising data ("slow by design"), prioritising freshness and simplicity over performance. The paper describes the architecture, a driver model covering 13 source types, an OWL ontology ingestion pipeline, a browser-based visual query builder, and a curated catalog of 63 publicly accessible data sources.

The topic is relevant and the implementation appears functional; however, the manuscript in its current form has several significant weaknesses that should be addressed before publication.

---

### Major Issues

**1. Insufficient novelty argumentation**

The paper does not adequately articulate what makes Mozg's contribution distinct from existing federated query layers (Hasura, Prisma, PostGraphile, Hydra, etc.) or from simple API gateways. The "slow by design" framing is a design philosophy, not a technical contribution in itself. Section 2 (Related Work) lists prior systems but does not provide a structured comparison table mapping capabilities. A feature-comparison table against at least three comparable systems (e.g., Hasura, GraphQL Mesh standalone, Ontop) would strengthen the contribution claim.

**2. Evaluation methodology is insufficient**

- The "functional evaluation" (Section 6.1) lacks a formal test protocol. Stating that "all eight sources passed all three tests" without describing the exact queries, the expected vs. actual outputs, or any automated test harness is not reproducible.
- Latency measurements (Section 6.3) are medians over only 20 requests from a single residential broadband connection. This is insufficient as a performance characterisation. At minimum, standard deviations or interquartile ranges should be reported, and the measurement should ideally be repeated from multiple network locations or a server-class machine. The current results conflate network jitter with system performance.
- There is no stress or concurrency evaluation. For a Node.js single-process application, throughput under concurrent requests is a critical omission.

**3. Missing formal semantics for the query model**

The paper informally describes `hasMany`/`hasOne`/`belongsTo` relationships and nested-loop join execution, but provides no formal definition of the query algebra. Without this, correctness claims (e.g., whether the join semantics are inner join, left outer join, etc.) cannot be verified. A small formal definition or at least a precise prose specification is needed.

**4. Security issues are inadequately addressed**

Section 7.2 lists six known security vulnerabilities (SSRF, Cypher injection, path traversal, connection-cache collision, N+1 REST, BioCyc re-fetch) as "intentionally deferred." Listing unmitigated security vulnerabilities in a published paper without severity ratings (CVSSv3 or similar) or disclosure timelines is problematic. At minimum, the paper should: (a) rate the severity of each issue, (b) clarify whether the tool should be considered unsafe for production use, and (c) provide a recommended workaround for each.

**5. No empirical comparison with a baseline system**

The evaluation compares Mozg only against itself. There is no comparison against an alternative system performing the same cross-source join. Even an informal "Mozg vs. manual curl + jq" baseline would contextualise the latency numbers.

---

### Minor Issues

1. **Abstract voice inconsistency**: The abstract and body use "We" (plural) while the author field lists a single author. This should be made consistent.

2. **Vague hardware specification**: Section 6.2 states "a laptop with an Intel Core i7" without specifying the generation, clock speed, or available RAM. These details are necessary for reproducibility of the ontology parse-time results.

3. **Terms vs. triples inconsistency**: Section 6.2 describes the Gene Ontology fragment as "~50,000 terms" and then immediately as "~50,000 triples." These are not equivalent; a single OWL class can generate many triples. The paper should use one consistent unit.

4. **Typo**: Line 501, "TrypanocyC" — the capitalisation inconsistency suggests a typographic error (should be "TrypanocyC" or "Trypanosoma CyC" consistently with other entries).

5. **BibTeX errors**: The `owl2` entry uses `howpublished` inside an `@article` entry, which is invalid BibTeX. It should be converted to `@misc` or `@techreport`. Several other entries mix `journal` and `howpublished`.

6. **Unsupported claim**: The conclusion states Mozg "can be launched in a fully configured cloud environment via GitHub Codespaces in under two minutes." No evidence is provided; this should either be removed, cited, or accompanied by a measurement.

7. **Architecture figure**: Figure 1 references `mozg-architecture` (a Mermaid `.mmd` file). The paper cannot be compiled as a standalone PDF without rendering this diagram externally. The repository should include a pre-rendered PNG/PDF version, and the paper should describe the figure generation process.

8. **Missing related work**: The paper does not cite or discuss Hasura, Prisma, or DGraph — all of which provide GraphQL over heterogeneous data sources and are directly relevant to positioning.

9. **Connection model security**: Section 3.3 describes credentials being supplied "on every request" and states this "simplifies the threat model." However, transmitting credentials on every request over HTTP (not just HTTPS) is a significant risk. The paper should mandate HTTPS and describe how the server enforces this.

---

### Recommendation

**Major revision required.** The core contribution is interesting and the implementation appears genuine, but the paper requires: (1) a stronger novelty argument with a structured comparison, (2) a more rigorous evaluation with statistical analysis and concurrency tests, (3) formal query semantics, and (4) a more responsible treatment of the known security vulnerabilities.

---

### Summary for Authors

| # | Category | Issue | Severity |
|---|----------|-------|----------|
| 1 | Novelty | No structured comparison with related systems | Major |
| 2 | Evaluation | 20-request median latency, no concurrency test | Major |
| 3 | Methodology | No formal query algebra | Major |
| 4 | Security | Unmitigated CVEs with no severity ratings | Major |
| 5 | Evaluation | No baseline comparison | Major |
| 6 | Writing | "We" vs. single author inconsistency | Minor |
| 7 | Reproducibility | Vague hardware spec for performance results | Minor |
| 8 | Technical | Terms vs. triples inconsistency | Minor |
| 9 | Writing | Typo "TrypanocyC" | Minor |
| 10 | Technical | BibTeX errors in `owl2` and related entries | Minor |
| 11 | Claims | Unsupported "under two minutes" claim | Minor |
| 12 | Reproducibility | Architecture figure not compilable | Minor |
| 13 | Related work | Hasura/Prisma/DGraph not discussed | Minor |
| 14 | Security | No mention of HTTPS enforcement | Minor |

