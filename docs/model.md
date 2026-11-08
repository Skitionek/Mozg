# The model: how databases connect through ontologies

Mozg has no global schema and stores no data.  What lets one query run across UniProt, Reactome, Open Targets and the rest is much smaller: a shared vocabulary of **identifier spaces**, many of them ontologies, such as MONDO, the Gene Ontology, the Human Phenotype Ontology and ChEBI.

This page shows that structure, drawn from the live catalog.

<!-- model-graph -->

## How to read it

- A **pill** is an identifier space.  A teal-outlined pill is an ontology (the project's own list: GO, MONDO, EFO, DOID, HP, ChEBI, NCIT, UBERON and CL); a grey-outlined one is the identifier space of a database or a standard, like UniProt accessions or Ensembl ids.  It is called an *OBO key* in Mozg.
- A **coloured shape** is one entity of one database: a table, endpoint or record type.  Each database has its own colour *and* its own shape, so you never have to tell them apart by colour alone.
- A **line** joins an entity to an identifier space it carries: one of its fields returns values of that kind, or one of its parameters accepts them.  The line takes the colour of the database.
- A pill with lines from several colours is a **meeting point**: those databases can be joined there.

Mozg's rule is simple: *same key and same value name the same thing*.  UniProt's `protein` returns UniProt accessions and Reactome's `pathwaysForProtein` accepts one, so a query can hand `P04637` from the first to the second without anyone writing the join out.  Where an entity carries more than one key, it can be joined on any of them.

## From the picture to a query

Every line in the graph is something you can use.  Naming a relation in `include` follows it, and `include: ["source/entity"]` follows any join the keys make possible, even one nobody declared:

```graphql
{
  query(input: {
    source: "uniprot"
    from: "protein"
    where: { uniprotAccession: "P04637" }
    include: ["pdbe/bestStructures"]
  }) { data }
}
```

The `catalog` query lists, for each entity, the joins it can make (`links`) and the identifier space behind each:

```graphql
{
  catalog(name: "uniprot") {
    entities { name links { name obo } }
  }
}
```

The `oboKeys` query lists the identifier spaces themselves.  To resolve a *value* to an ontology term (a label, a synonym, an identifier in any spelling), use [`link`](../README.md#linking-values-to-ontology-terms).

## What the picture leaves out

- **Different keys for the same thing are not joined.**  An Ensembl gene id and an NCBI Gene id name the same gene, but they are different keys, so two entities that carry only one each do not meet.  An entity that carries both is the bridge: HGNC's `gene` returns an Ensembl gene id and an NCBI Gene id, so a query can cross from one to the other through it.  The graph shows this honestly: they are separate pills.
- **Ontology structure is not drawn.**  The pills are identifier spaces; the hierarchy inside MONDO or GO is not part of the picture.
- **Declared relations are optional.**  Beyond the key joins, entities declare relations to each other.  Turn them on in the graph to see them as arrows.
- **Entities that share nothing are hidden** by default, since the picture is about connections.  The table lists everything that is drawn.

## Add your own database

A database joins the picture by carrying keys.  Describe its entities in a catalog entry and name the identifier space of each field and parameter that holds one (see [`src/catalog/README.md`](../src/catalog/README.md)); this page then shows it beside the others, and `include` can follow it to and from them.  A self-hosted SQL table or graph label joins the same way through its annotated columns ([Deploy](deploy.md)).
