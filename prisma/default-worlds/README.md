# Default Worlds

Default worlds are repo-tracked seed artifacts for a virgin Oasis database.

The SQLite database remains local and gitignored. These JSON files are the
portable content source of truth for core/template worlds such as Portal Zero.

Useful commands:

```bash
pnpm seed:default-worlds
pnpm seed:default-worlds -- --update-core --snapshot
pnpm world:export-default -- --world-id=world-welcome-hub-system --slug=portal-zero --name="Portal Zero" --manifest
```

`--snapshot` writes the previous DB state into the existing `WorldSnapshot`
table before overwriting a core seed world. It does not create a second visible
world in the registry.
