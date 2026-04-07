/**
 * Environment variable validation — call at app startup.
 * Warns about missing optional vars, throws on missing required vars.
 */

interface EnvVar {
  name: string;
  required: boolean;
  description: string;
}

const ENV_VARS: EnvVar[] = [
  { name: 'ASANA_TOKEN', required: false, description: 'Asana personal access token' },
  { name: 'ASANA_PROXY_URL', required: false, description: 'Asana proxy endpoint' },
  { name: 'ANTHROPIC_API_KEY', required: false, description: 'Anthropic API key for AI features' },
  { name: 'EMAIL_SERVICE_URL', required: false, description: 'Email service endpoint for alerts' },
];

export function checkEnvVars(env: Record<string, string | undefined> = {}): string[] {
  const warnings: string[] = [];

  for (const v of ENV_VARS) {
    const value = env[v.name];
    if (!value) {
      const msg = `${v.required ? 'MISSING' : 'Optional'}: ${v.name} — ${v.description}`;
      warnings.push(msg);
      if (v.required) {
        throw new Error(`Required environment variable not set: ${v.name}`);
      }
    }
  }

  return warnings;
}
