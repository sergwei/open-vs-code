// Fabricated data for the tests of the OpenCode Settings tab. NOT recorded from a real opencode:
// the shapes follow `src/shared/settingsProtocol.ts`, the provider names and the copilot form are
// those the planner spike saw in opencode 2.0.32 (01/11/2026), the values are invented. Only the
// tests import this file.
import type {
  ProviderRow,
  SettingsMcpServerRow,
  SettingsState,
} from '../../../src/shared/settingsProtocol';

/** A connected state with empty lists; tests override the parts they care about. */
export function makeState(overrides: Partial<SettingsState> = {}): SettingsState {
  return {
    connection: { state: 'connected', serverVersion: '2.0.32' },
    folder: 'my-project',
    serverVersion: '2.0.32',
    providers: { loaded: true, failed: false, rows: [] },
    mcp: { loaded: true, failed: false, pendingFirstRead: false, servers: [] },
    ...overrides,
  };
}

/** Anthropic: connected through a stored API key. */
export const anthropic: ProviderRow = {
  id: 'anthropic',
  name: 'Anthropic',
  connections: [{ kind: 'credential', id: 'cred_1', label: 'Anthropic', method: 'key' }],
  methods: [{ index: 0, type: 'key', label: 'API key', fields: [], supported: true }],
};

/** Vertex: connected through an environment variable (nothing to remove). */
export const vertex: ProviderRow = {
  id: 'google-vertex',
  name: 'Google Vertex',
  connections: [{ kind: 'env', name: 'GOOGLE_APPLICATION_CREDENTIALS' }],
  methods: [],
};

/** Azure: not connected, an API key method whose form asks for the resource name. */
export const azure: ProviderRow = {
  id: 'azure',
  name: 'Azure',
  connections: [],
  methods: [
    {
      index: 0,
      type: 'key',
      label: 'API key',
      fields: [
        {
          key: 'resourceName',
          title: 'Resource name',
          description: 'The name of your Azure OpenAI resource.',
          required: true,
          placeholder: 'my-resource',
        },
      ],
      supported: true,
    },
  ],
};

/** GitHub Copilot: OAuth with a deployment type; the enterprise URL only for Enterprise. */
export const copilot: ProviderRow = {
  id: 'github-copilot',
  name: 'GitHub Copilot',
  connections: [],
  methods: [
    {
      index: 0,
      type: 'oauth',
      id: 'device',
      label: 'Login with GitHub',
      supported: true,
      fields: [
        {
          key: 'deploymentType',
          title: 'Deployment type',
          required: true,
          options: [
            { value: 'github.com', label: 'GitHub.com' },
            { value: 'enterprise', label: 'GitHub Enterprise' },
          ],
        },
        {
          key: 'enterpriseUrl',
          title: 'Enterprise URL',
          required: true,
          when: [{ key: 'deploymentType', op: 'eq', value: 'enterprise' }],
        },
      ],
    },
  ],
};

/** Bedrock: an external method (no browser, no key). */
export const bedrock: ProviderRow = {
  id: 'amazon-bedrock',
  name: 'Amazon Bedrock',
  connections: [],
  methods: [
    {
      index: 0,
      type: 'external',
      id: 'profile',
      label: 'AWS profile',
      fields: [],
      supported: true,
    },
  ],
};

/** OpenAI: several ways to connect. */
export const openai: ProviderRow = {
  id: 'openai',
  name: 'OpenAI',
  connections: [],
  methods: [
    { index: 0, type: 'key', label: 'API key', fields: [], supported: true },
    {
      index: 1,
      type: 'oauth',
      id: 'browser',
      label: 'ChatGPT (browser)',
      fields: [],
      supported: true,
    },
    {
      index: 2,
      type: 'oauth',
      id: 'headless',
      label: 'ChatGPT (code)',
      fields: [],
      supported: true,
    },
  ],
};

/** The four MCP states, one server each, as the fake server lists them. */
export const mcpServers: SettingsMcpServerRow[] = [
  {
    name: 'docs',
    status: 'connected',
    resources: [{ name: 'readme.md', uri: 'file:///readme.md', mimeType: 'text/markdown' }],
    templates: [{ name: 'files', uriTemplate: 'file:///{path}' }],
  },
  {
    name: 'broken',
    status: 'failed',
    error: 'Connection closed: MCP server process exited',
    resources: [],
    templates: [],
  },
  { name: 'off', status: 'disabled', resources: [], templates: [] },
  { name: 'linear', status: 'needs_auth', resources: [], templates: [] },
];
