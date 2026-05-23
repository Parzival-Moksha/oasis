# Default Worlds

Default worlds are repo-tracked seed artifacts for a virgin Oasis database.

The SQLite database remains local and gitignored. These JSON files are the
portable content source of truth for core/template worlds such as Portal Zero.
In local mode, and in hosted mode for an authenticated admin, saving a
seed-backed `core` or `template` world mirrors the edited world back into this
folder so the next seed run does not overwrite the change.

Useful commands:

```bash
pnpm seed:default-worlds
pnpm seed:default-worlds -- --update-core --snapshot
pnpm world:export-default -- --world-id=world-welcome-hub-system --slug=portal-zero --name="Portal Zero" --manifest
```

`pnpm deploy:openclaw` runs `pnpm seed:default-worlds -- --update-core
--snapshot` on the hosted box by default after the build. Pass
`--skip-core-seed` to the deploy script only when you deliberately want to
leave hosted seed-backed worlds untouched.

`--snapshot` writes the previous DB state into the existing `WorldSnapshot`
table before overwriting a core seed world. It does not create a second visible
world in the registry.
