---
name: review-db-schema
description: Review any changes to the database schema.
---

Make sure that the answer to the following questions is "yes":

- Can we keep this data in memory instead? Sometimes we have ephemeal information that do not need to be persisted
- If a new table was created, was it necessary? It's best to limit the tables unless we have One to Many or Many to Many relationships.
- Did you introduce versions without any reason? If a feature was just introduced, there's no need for it
