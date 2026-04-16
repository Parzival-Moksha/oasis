import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const docsUrl = process.env.DOCS_URL || 'https://parzival-moksha.github.io'
const docsBaseUrl = process.env.DOCS_BASE_URL || '/oasis/'
const docsRouteBasePath = process.env.DOCS_ROUTE_BASE_PATH || 'docs'
const docsPrefix = docsRouteBasePath === '/' ? '' : '/docs'
const docLink = (path: string) => `${docsPrefix}${path}`

const config: Config = {
  title: 'The Oasis',
  tagline: 'Local-first 3D world building for humans and agents',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: docsUrl,
  baseUrl: docsBaseUrl,

  organizationName: 'Parzival-Moksha',
  projectName: 'oasis',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/Parzival-Moksha/oasis/tree/main/website/',
          routeBasePath: docsRouteBasePath,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/oasis-social-card.png',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'The Oasis',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/Parzival-Moksha/oasis',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting Started', to: docLink('/getting-started/quickstart') },
            { label: 'User Guide', to: docLink('/user-guide/controls') },
            { label: 'Agent Guide', to: docLink('/agents/overview') },
          ],
        },
        {
          title: 'Developer',
          items: [
            { label: 'Architecture', to: docLink('/developer/architecture') },
            { label: 'API Reference', to: docLink('/reference/api-routes') },
          ],
        },
        {
          title: 'Links',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/Parzival-Moksha/oasis',
            },
          ],
        },
      ],
      copyright: 'The Oasis documentation site',
    },
    prism: {
      theme: prismThemes.dracula,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
