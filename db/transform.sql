-- Builds the normalized `app` schema from the verbatim `raw` JSONB tables.
-- Every app table is derived from the example data; nothing here is invented.

drop schema if exists app cascade;
create schema app;

create table app.institutions as
select record->>'id' as id, record->>'name' as name from raw.institution;

create table app.skills as
select record->>'id' as id, record->>'name' as name, record->>'type' as type,
       (record->>'isSoftware')::boolean as is_software,
       record->'category'->>'name' as category
from raw.skill;

create table app.occupations as
select record->>'code' as code, record->>'name' as name, record->>'description' as description
from raw.occupation;

create table app.geography as
select record->>'taxonomyId' as taxonomy, record->>'code' as code, record->>'name' as name, record->>'level' as level
from raw.geography;

create table app.programs as
select record->>'id' as id, record->>'institutionId' as institution_id, record->>'name' as name,
       record->>'programTypeId' as program_type_id, record->'fieldOfStudy'->>'code' as cip_code,
       record->'fieldOfStudy'->>'name' as cip_name, record->>'description' as description
from raw.program;

create table app.program_courses as
select p.record->>'id' as program_id, c->>'courseId' as course_id, (c->>'isRequired')::boolean as is_required
from raw.program p, jsonb_array_elements(p.record->'courses') c;

create table app.program_skills as
select p.record->>'id' as program_id, s->>'skillId' as skill_id, (s->>'isLearningObjective')::boolean as is_learning_objective
from raw.program p, jsonb_array_elements(coalesce(p.record->'skills', '[]')) s;

create table app.program_targets as
select p.record->>'id' as program_id, o->>'code' as occ_code
from raw.program p, jsonb_array_elements(coalesce(p.record->'targetOccupations', '[]')) o;

create table app.courses as
select record->>'id' as id, record->>'institutionId' as institution_id, record->>'code' as code,
       record->>'name' as name, (record->>'credits')::numeric as credits
from raw.course;

create table app.course_skills as
select c.record->>'id' as course_id, s->>'skillId' as skill_id
from raw.course c, jsonb_array_elements(coalesce(c.record->'skills', '[]')) s;

create table app.posting_metrics as
select record->'occupation'->>'code' as occ_code, record->'geography'->>'code' as geo_code,
       record->'geography'->>'name' as geo_name, record->'period'->>'start' as period_start,
       (record->>'uniquePostings')::int as unique_postings, (record->>'totalPostings')::int as total_postings,
       (record->>'uniqueEmployers')::int as unique_employers,
       (record->'medianSalary'->>'amount')::numeric as median_salary,
       (record->>'postingIntensity')::numeric as posting_intensity
from raw.posting_metrics;

create table app.posting_growth as
select record->'occupation'->>'code' as occ_code, record->'geography'->>'code' as geo_code,
       record->'baselinePeriod'->>'start' as baseline_start, record->'comparisonPeriod'->>'start' as comparison_start,
       (record->>'baselinePostings')::int as baseline_postings, (record->>'comparisonPostings')::int as comparison_postings,
       (record->>'growthRate')::numeric as growth_rate
from raw.posting_growth;

create table app.benchmark_skills as
select b.record->'occupation'->>'code' as occ_code, b.record->'geography'->>'code' as geo_code,
       b.record->'period'->>'start' as period_start, s->>'skillId' as skill_id,
       (s->>'postingCount')::int as posting_count, (s->>'weight')::numeric as weight
from raw.occupation_benchmark b, jsonb_array_elements(b.record->'skills') s;

create table app.alignment as
select record->>'programId' as program_id, record->'occupation'->>'code' as occ_code,
       record->'occupation'->>'name' as occ_name, record->'geography'->>'code' as geo_code,
       record->'period'->>'start' as period_start, (record->>'score')::numeric as score
from raw.occupation_alignment;

create table app.alumni as
select r.record->>'id' as id,
       r.record->>'personId' as person_id,
       r.record->'education'->>'institutionId' as institution_id,
       r.record->'education'->>'educationProgramId' as education_program_id,
       regexp_replace(r.record->'education'->>'educationProgramId', '^education-', 'program-') as program_id,
       r.record->'education'->'fieldOfStudy'->>'code' as cip_code,
       r.record->'education'->'degreeLevel'->>'code' as degree_level,
       (r.record->'education'->>'graduationYear')::int as graduation_year,
       (r.record->'education'->>'graduated')::boolean as graduated,
       r.record->'employment' is not null as has_employment,
       r.record->'employment'->'employer'->>'name' as employer,
       r.record->'employment'->>'jobTitle' as job_title,
       r.record->'employment'->'occupation'->>'code' as occ_code,
       r.record->'employment'->'occupation'->>'name' as occ_name,
       (r.record->'employment'->>'employedInField')::boolean as in_field,
       (r.record->'employment'->'estimatedWage'->>'amount')::numeric as wage_amount,
       r.record->'employment'->'estimatedWage'->>'period' as wage_period,
       (r.record->'employment'->'occupationMedianWage'->>'amount')::numeric as occ_median_wage,
       r.record->'employment'->'occupationMedianWage'->>'period' as occ_median_period,
       (r.record->'employment'->'occupationWage10thPercentile'->>'amount')::numeric as occ_p10_wage,
       (r.record->'employment'->'occupationWage90thPercentile'->>'amount')::numeric as occ_p90_wage,
       r.record->'location' is not null as has_location,
       (r.record->'location'->>'residesInServiceRegion')::boolean as resides_in_region,
       (r.record->'location'->>'isInternational')::boolean as is_international,
       r.record->'contact'->>'preferredEmail' is not null as has_email,
       r.record->'contact'->>'linkedInId' is not null as has_linkedin,
       r.record->'demographics'->'graduationAgeBand'->>'code' as grad_age_band
from raw.alumni_record r;

create table app.career_events as
select r.record->>'id' as alumni_id, e->>'type' as type, e->>'startDate' as start_date, e->>'endDate' as end_date,
       e->'occupation'->>'code' as occ_code, (e->>'employedInField')::boolean as in_field,
       e->'organization'->>'name' as organization,
       (e->'estimatedWage'->>'amount')::numeric as wage_amount, e->'estimatedWage'->>'period' as wage_period,
       (e->'checkpoint'->>'yearsAfterEducation')::int as checkpoint_years
from raw.alumni_record r, jsonb_array_elements(coalesce(r.record->'careerEvents', '[]')) e;

create table app.education_history as
select r.record->>'id' as alumni_id, h.seq, h.value->>'relationship' as relationship,
       h.value->'institution'->>'id' as institution_id, h.value->'institution'->>'name' as institution_name
from raw.alumni_record r, jsonb_array_elements(coalesce(r.record->'educationHistory', '[]')) with ordinality as h(value, seq);

-- Months from graduation to first job: first employment start in or after the graduation year,
-- measured from June of the graduation year (graduation month isn't in the data).
create view app.alumni_time_to_job as
select a.id as alumni_id, a.program_id, a.institution_id,
       (extract(year from first_job)::int - a.graduation_year) * 12 + extract(month from first_job)::int - 6 as months
from app.alumni a
join lateral (
  select min(to_date(left(e.start_date, 7) || case when length(e.start_date) >= 7 then '-01' else '-06-01' end, 'YYYY-MM-DD')) as first_job
  from app.career_events e
  where e.alumni_id = a.id and e.type = 'employment' and e.start_date is not null
    and left(e.start_date, 4)::int >= a.graduation_year
) j on true
where a.graduated and a.graduation_year is not null and first_job is not null
  and (extract(year from first_job)::int - a.graduation_year) * 12 + extract(month from first_job)::int - 6 >= 0;

create index on app.alumni (program_id);
create index on app.alumni (institution_id);
create index on app.career_events (alumni_id);
create index on app.benchmark_skills (occ_code, geo_code, period_start);
create index on app.alignment (program_id);
