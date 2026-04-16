import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/quickstart',
        'getting-started/installation',
        'getting-started/first-world',
      ],
    },
    {
      type: 'category',
      label: 'User Guide',
      items: [
        'user-guide/controls',
        'user-guide/conjuring',
        'user-guide/crafting',
        'user-guide/terrain',
        'user-guide/sky-and-lighting',
        'user-guide/audio',
        'user-guide/avatars',
        'user-guide/worlds',
      ],
    },
    {
      type: 'category',
      label: 'Agent Guide',
      items: [
        'agents/overview',
        'agents/merlin',
        'agents/anorak',
        'agents/claude-code',
        'agents/hermes',
        'agents/devcraft',
        'agents/mcp-tools',
        'agents/3d-windows',
      ],
    },
    {
      type: 'category',
      label: 'Developer Guide',
      items: [
        'developer/architecture',
        'developer/state-management',
        'developer/persistence',
        'developer/input-system',
        'developer/phoenix-protocol',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/api-routes',
        'reference/keybinds',
        'reference/asset-catalog',
        'reference/data-model',
        'reference/gotchas',
      ],
    },
  ],
};

export default sidebars;
