# Prototype product data

32 portable JSON Schema Draft 7 files for the substantive data behind curriculum alignment and alumni outcomes. These are models for a **new product**, informed by Ark's domain data—not copies of its endpoints, report parameters, storage conventions, or UI state.

Each file describes one record or domain value. Collections are ordinary arrays of records; there are no `data`, `attributes`, `ranking`, `buckets`, pagination, query, or report envelopes. Every record rejects undeclared properties so old implementation fields cannot silently creep back in.

Every schema includes a synthetic example and has a matching JSON data file beside it: `program.schema.json` pairs with `program.json`, for example. [`catalog.json`](./catalog.json) lists every schema, its companion filename and record count, its source-code evidence, and whether it represents source data, derived data, or a shared value. Source references explain the meaning of the data; they do **not** claim that the new shape is an existing API contract.

## Realistic prototype datasets

The 32 companion files now mix **real public reference data** with a **coherent fictional regional scenario**, rather than padding every file to the same size. The snapshot is **December 31, 2025**. Current counts, provenance, and narrative case IDs are in [`reference/distribution.json`](./reference/distribution.json), [`catalog.json`](./catalog.json), and the [reference/scenario guide](./reference/README.md).

| Dataset | Records | Interpretation |
| --- | ---: | --- |
| Institutions | 6 | Different fictional institutional types and sizes |
| Program types | 6 | Small lookup, not hundreds of invented categories |
| Curriculum programs | 214 | 14–92 per institution |
| Courses | 1,058 | Shared prerequisites, specialty courses, and graduate coursework |
| Occupations | 1,016 | Public O*NET occupation titles and descriptions |
| Skills | 670 | Public O*NET basic/technology labels plus curated domain skills and credentials |
| Geography | 3,295 | Real county/equivalent, state/territory, and country references |
| Alumni records | 2,685 | 2,600 fictional primary people/education records plus 85 subsequent awards |
| Career events | 9,363 | Dated education and employment history, including valid checkpoints |

**47,494 records** are present across the 32 companion files. This is not a unique-people count: reference values and child records are deliberately shared across files. Every file is a plain array, with unique full records within that file. Child datasets are deduplicated projections, so a small location or program-type file is normal—not a reason to invent more categories.

The institutions differ deliberately: a large research university, community college, technical institute, small liberal-arts college, rural polytechnic, and healthcare specialist. Popular programs attract larger cohorts, recent graduation years are more numerous, employers are reused, and course maps differ by award and discipline. Smaller graduate specialties and short certificates remain small.

Ten authored anchor journeys demonstrate returning-adult nursing, a welding-to-fabrication pathway, a psychology-to-HR career change, postgraduate study, relocation, non-completion, and recently unmatched graduates. Ordinary alumni vary around those institutions and disciplines through **seeded conditional simulation**, not row-number formulas or an evenly balanced Cartesian product. Dates, occupations, credential levels, skill coverage, and wage units are kept coherent. Historical checkpoints do not borrow current wage estimates.

**What is real:** O*NET occupation/basic-skill/technology references, NCES CIP 2020 titles/definitions, and Census 2020 county codes. **What is fictional:** institutions, curricula, employers, people, NSC-shaped histories, enrollment, wages, posting volumes, inferred salary-boosting flags, and all modeled outcomes. Sources, transformations, hashes, and O*NET attribution/license are documented in [`reference/README.md`](./reference/README.md). Do not interpret fictional outcomes attached to a real occupation or county as actual statistics about that occupation or county.

Names look like ordinary names, but identities are invented. Emails use `example.invalid`; there are no real social-profile links or phone numbers. Wage and demographic distributions are authored demo assumptions, **not empirically calibrated estimates or evidence of real group outcomes**. Gender/race/ethnicity do not determine generated wage amounts or job assignment.

Reproduce the exact scenario offline:

```sh
python3 schemas/data-products/generate-samples.py
node schemas/data-products/validate.cjs
```

Generation uses Python's standard library and the frozen public-reference bundle. It overwrites paired files, updates catalog counts/origins, and regenerates the distribution audit; it does not change the schemas or access customer data. Random choices are reproducible with the recorded seed. Refreshing public references is a separate, explicit action.

IDs and classification references resolve within the data. Employers, campuses, and skill categories are defined inline and reused consistently. `common.json` contains just 13 representative shared values rather than 300 padded pseudo-records. Service-region definitions used to check membership are audit metadata in `reference/distribution.json`, not legacy account/site plumbing.

## Inventory

All names below are filenames with `.schema.json` appended.

| Data family | Schemas |
| --- | --- |
| Reference data | `institution`, `occupation`, `geography`, `classification-concept`, `skill` |
| Curriculum | `program`, `course`, `program-type`, `program-course`, `curricular-skill`, `target-occupation` |
| Institution education programs | `education-program` |
| Crosswalks and similarity | `program-occupation-mapping`, `classification-mapping`, `similarity-match` |
| Labor-market observations and benchmarks | `posting-metrics`, `posting-growth`, `weighted-skill`, `occupation-benchmark`, `occupation-alignment`, `salary-boosting-skill`, `skill-program-count` |
| Alumni education and outcomes | `alumni-record`, `alumni-education`, `alumni-employment`, `alumni-location`, `alumni-demographics`, `alumni-skills`, `alumni-pii`, `nsc-education`, `career-event` |
| Shared values | `common` |

Derived schemas describe substantive calculated observations—such as an occupation's weighted skill benchmark or a program's alignment score—not the settings or function arguments used to request a calculation. They are labeled `derived-data` in the catalog.

## Example: a curriculum program

```json
{
  "id": "program-north-sound-state-cs-bachelor",
  "institutionId": "north-sound-state",
  "name": "Computer Science, B.S.",
  "fieldOfStudy": {
    "taxonomyId": "cip_2020",
    "code": "11.0701"
  },
  "skills": [
    { "skillId": "technology-18885f27b5af", "isLearningObjective": true }
  ],
  "courses": [
    { "courseId": "course-north-sound-state-cs-210", "isRequired": true }
  ],
  "targetOccupations": [
    { "taxonomyId": "onet_soc_2019", "code": "15-1252.00" }
  ]
}
```

This abbreviated example illustrates the shape using fixture identifiers; consult the companion file for the full record. This is the program's data, not a request to run a report about it. A course has its own record; whether it is required belongs to the program/course relationship. Skills are ordinary arrays, never JSON strings or objects whose keys are skill IDs.

## Example: an alumni record

```json
{
  "id": "alumni-north-sound-state-00001",
  "personId": "synthetic-person-00001",
  "education": {
    "institutionId": "north-sound-state",
    "educationProgramId": "education-north-sound-state-cs-bachelor",
    "graduationYear": 2018,
    "graduated": true
  },
  "employment": {
    "occupation": { "taxonomyId": "onet_soc_2019", "code": "15-1252.00" },
    "estimatedWage": null
  },
  "skills": [
    { "skillId": "technology-18885f27b5af" }
  ],
  "careerEvents": [
    {
      "type": "employment",
      "occupation": { "taxonomyId": "onet_soc_2019", "code": "15-1252.00" },
      "checkpoint": { "yearsAfterEducation": 3, "openEnded": false }
    }
  ]
}
```

The record is education/award-grained, not necessarily a unique person. Multiple award records may share a `personId`; an unmatched record can omit it. Do not sum record or career-event counts and label them unique people.

An institution's education program is not assumed to share an ID with a curriculum program. Relate them deliberately, for example through institution context and field-of-study classification; do not manufacture an identity match.

## What was removed

- Report/packet inputs, query bodies, filter expressions, JSON-encoded selections, and calculation-argument wrappers.
- Account/dataset/service metadata, active-dataset routing, site keys, occupation favorites, caches, and download plumbing.
- API resource envelopes, bulk/count response wrappers, ranking/sequence/intersection response structures, and report-oriented timeseries containers.
- Publication and review workflows, revisit flags, linked/root aggregation flags, renderer fields, icons, and jumplinks.
- The shared curricular API resource abstraction and API-specific program-type-class hierarchy.
- Skill-extraction trace transport. Curriculum descriptions, syllabi, learning objectives, skill assignments, and master skill records remain as substantive data.
- Duplicate NSC schemas for column prefixes. One education-history schema now covers prior, focal-institution, and subsequent observations.
- Legacy prefixed column names, key/value display pairs, field-name companions, and numeric checkpoint IDs.

## Normalization decisions

These are explicit **prototype design decisions**, not claims about the old payloads:

| Old representation | Prototype representation |
| --- | --- |
| `{type, id, attributes}` curriculum resource | Plain program or course record |
| Curriculum `title`, `courseCode`, `cipCode` | `name`, course `code`, qualified `fieldOfStudy` |
| Site/account identifiers | Product-local `institutionId` relationships; resolving the institution is a separate import concern |
| Expanded program type/class resource | Program type with `id`, `name`, optional category |
| Skill assignments keyed by ID or mixed strings/objects | Arrays of `{skillId, isLearningObjective}` records |
| Course relationship embedded in an expanded API resource | `{courseId, isRequired}` |
| Flat `inst_*`, `emp_*`, `nsc_*` columns | Education, employment, location, demographics, and education-history records |
| Classification `{key, value}` and separate `*_name` columns | `{taxonomyId, code, name?}` references |
| Bare occupation or geography codes | Codes qualified by taxonomy; version belongs in the taxonomy identifier |
| NSC prior/current/subsequent column groups | Education-history records with a `relationship` |
| Checkpoint IDs 1,2,3,4,5 | Actual 1,3,5,10,15+ elapsed years; the last has `openEnded: true` |
| Monetary number with an implicit unit | `{amount, currency, period}`; importers must obtain currency and hour/year basis from source context, not guess |
| Missing values displayed as `N/A` or `Insf. Data` | Null for unavailable nullable measurements; otherwise omit unknown optional fields |
| Code-keyed crosswalks and bulk salary-boosting responses | Individual relationship records |
| Implicit geography/time context on market metrics | Explicit geography and period on each observation/benchmark |

Identifiers retain leading zeros and punctuation. Dates retain source precision: year, year-month, or date. No precision is invented. Classification values are not arbitrary display strings: their taxonomy must be known.

A field being optional does not give it a default. In particular, absent skill data is not proof that no skills are taught; a missing wage is not zero; an absent employment observation is not proof of unemployment. Null measurements mean unavailable, not a formatted display value.

The location's `isInternational` flag is relative to `referenceCountry`. A service-region membership value is meaningful only with the corresponding `serviceRegionId`; importers must retain that context.

## Evidence and limits

The investigation used these principal producers and consumers:

- `includes/namespaces/curricularskillsapi.inc`: curriculum records, course memberships, skills, target occupations, and skill/program counts.
- `includes/classes/packet/packet_skillabi.class.inc`: posting metrics, weighted skill benchmarks, growth, alignment, and salary-boosting skill membership.
- `includes/namespaces/{skillsapi,similaritiesapi,classificationapi,salaryboostingskillsapi}.inc`: skills, similarity, crosswalks, and salary-boosting relationships.
- `includes/classes/{alumnipathwaysslice,classification}.class.inc`: institution program and other classification/reference values.
- `includes/classes/packet/packet_alumni_pathways.class.inc` and `includes/namespaces/alumnipathwaysapi.inc`: education, employment, wages, residence, demographics, contact data, NSC history, and career events.

Ark does not establish the complete original institution/NSC/profile upload contracts. These models are not upload templates and are not automatically convertible without source-context decisions. In particular:

- New local IDs and institution links must be assigned/resolved intentionally. An old site ID is not automatically an institution ID.
- Flat repeated source fields must be correctly paired into education-history records; do not blindly zip unrelated arrays.
- Coarse employment status categories may need to remain unknown when producing `employedInField`; do not force every category to true or false.
- Money units, taxonomy versions, checkpoint reference dates, and service-region context must be established from the actual data provider.
- Similarity observations here are pairwise. The old model also accepts whole skill sets; this schema does not preserve its batching or request/result association mechanism.
- Referential integrity, calendar-valid dates, temporal ordering, arithmetic, unique skill memberships, and deduplication require checks beyond these schemas.
- Schema examples are illustrative. Companion datasets mix attributed public references with fictional scenarios; see the origin of each file in the catalog. No real PII is included. Handling real PII requires separate authorization; the schema itself grants none.

The legacy product is evidence for **which data matters**, not the architecture for the prototype.

## Validation

From the repository root:

```sh
node schemas/data-products/validate.cjs
```

The standalone checker uses the existing Ajv dependency to compile every schema, resolve references, validate examples and positive/negative cases, check source paths/catalog entries, and reject legacy properties or encoded JSON inside schema definitions. It also validates all companion records, per-file uniqueness, public-reference snapshot hashes and labels, local references, curriculum relationships, calendar-valid dates, chronology, service-region membership, wage quantiles, posting arithmetic, normalized skill weights, calculated alignment, and program coverage. Distribution checks reject uniform padding, and journey checks exercise the named scenarios. It intentionally does not validate compatibility with old API fixtures.

Coding agents should follow the execution rules in `AGENTS.md`. The authoring session's dev container did not expose this checkout's new files, so standalone static checks were run on the host without changing the environment.
