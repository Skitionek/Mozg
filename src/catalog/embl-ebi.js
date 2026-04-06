'use strict';

/**
 * EMBL-EBI – European Bioinformatics Institute data resources.
 * Reference: https://www.ebi.ac.uk/
 * API docs:  https://www.ebi.ac.uk/ena/portal/api/doc
 *
 * This entry targets the ENA (European Nucleotide Archive) Portal API,
 * the primary EMBL-EBI nucleotide sequence resource accepting open access.
 *
 * No credentials required for public data.
 *
 * Key where parameters for /search:
 *  - query:   Lucene query string (e.g. "tax_eq(9606)")
 *  - result:  result type – sequence, study, experiment, run, sample, analysis, …
 *  - fields:  comma-separated list of fields to return
 *  - format:  json (required)
 *  - limit / offset: pagination
 *
 * Example:
 *  where: { result: "sequence", query: "tax_eq(9606)", format: "json", limit: "20" }
 *
 * Relationship map:
 *  - /search (result=study)      →  /search (result=experiment, via study accession)
 *  - /search (result=experiment) →  /search (result=run, via experiment accession)
 *  - /search (result=sequence)   →  /search (result=study, via study_accession FK)
 */
module.exports = {
  name: 'embl-ebi',
  label: 'EMBL-EBI / ENA (REST)',
  description: 'European Bioinformatics Institute — ENA Portal API providing access to nucleotide sequences, studies, experiments, runs and samples. Use result=sequence|study|experiment|run|sample and format=json in where params.',
  driver: 'rest',
  connection: {
    database: 'https://www.ebi.ac.uk/ena/portal/api',
    headers: {
      'Accept': 'application/json',
    },
  },
  entities: [
    {
      // Use where: { result: "sequence", query: "…", format: "json" }
      name: '/search',
      columns: ['accession', 'description', 'scientific_name', 'tax_id', 'sequence_length', 'base_count', 'study_accession', 'experiment_accession', 'run_accession', 'first_public', 'last_updated'],
      relations: [],
    },
    {
      name: '/count',
      columns: ['count'],
      relations: [],
    },
    {
      // Returns available result types (studies, sequences, runs, etc.)
      name: '/results',
      columns: ['id', 'name', 'description', 'displayName'],
      relations: [],
    },
    {
      // Use where: { result: "sequence" } to list available fields for that result type
      name: '/returnFields',
      columns: ['columnId', 'freeText', 'description', 'type'],
      relations: [],
    },
  ],
};
