// Deploy the Go backend to Koyeb using the public REST API.
// The Koyeb Service is created on first run and updated on later runs.

const API_BASE_URL = "https://app.koyeb.com/v1";
const TERMINAL_FAILURES = new Set(["ERROR", "ERRORING", "CANCELED", "CANCELING", "STOPPED", "STOPPING"]);
const TERMINAL_SUCCESSES = new Set(["HEALTHY", "DEGRADED"]);
const OPTIONAL_ENV_VARS = ["PURUBOY_PG_URL", "PURUBOY_ADMIN_KEY", "GITHUB_TOKEN", "CF_PROXY"];

const apiToken = process.env.KOYEB_API_TOKEN;

if (!apiToken) {
  throw new Error("KOYEB_API_TOKEN is required (store it as a GitHub Actions secret).");
}

const appName = process.env.KOYEB_APP_NAME || "na-api";
const serviceName = process.env.KOYEB_SERVICE_NAME || "backend";
const region = process.env.KOYEB_REGION || "fra";
const instanceType = process.env.KOYEB_INSTANCE_TYPE || "free";
const port = parsePositiveInt("KOYEB_PORT", process.env.KOYEB_PORT, 8080);
const workdir = process.env.KOYEB_WORKDIR || "backend";
const dockerfile = process.env.KOYEB_DOCKERFILE || "Dockerfile";
const repository = process.env.KOYEB_GIT_REPOSITORY || `github.com/${requiredEnv("GITHUB_REPOSITORY")}`;
const branch = process.env.KOYEB_GIT_BRANCH || "main";
const deployTimeoutMs = parsePositiveInt("KOYEB_DEPLOY_TIMEOUT_MS", process.env.KOYEB_DEPLOY_TIMEOUT_MS, 900_000);
const pollIntervalMs = 10_000;

/**
 * Read a required environment variable and fail with a readable message.
 *
 * @param {string} name Environment variable name.
 * @returns {string} Non-empty variable value.
 */
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

/**
 * Parse a positive integer from the environment with a fallback value.
 *
 * @param {string} name Environment variable name, used in the error message.
 * @param {string | undefined} raw Raw environment value.
 * @param {number} fallback Value used when `raw` is empty.
 * @returns {number} Parsed positive integer.
 */
function parsePositiveInt(name, raw, fallback) {
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}".`);
  }
  return value;
}

/**
 * Call the Koyeb API and return the decoded JSON payload.
 *
 * @param {string} path API path starting with `/`.
 * @param {{ method?: string, body?: unknown }} [options] Request options.
 * @returns {Promise<any>} Decoded response body.
 */
async function koyebRequest(path, options = {}) {
  const { method = "GET", body } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`Koyeb ${method} ${path} failed with ${response.status}: ${text.slice(0, 800)}`);
  }
  return payload;
}

/**
 * Find an app by name, creating it when it does not exist yet.
 *
 * @param {string} name App name.
 * @returns {Promise<{ id: string, name: string }>} Koyeb app.
 */
async function ensureApp(name) {
  const { apps = [] } = await koyebRequest(`/apps?name=${encodeURIComponent(name)}`);
  const existing = apps.find((app) => app.name === name);

  if (existing) {
    console.log(`Using existing Koyeb app "${name}" (${existing.id}).`);
    return existing;
  }

  console.log(`Creating Koyeb app "${name}".`);
  const { app } = await koyebRequest("/apps", { method: "POST", body: { name } });
  return app;
}

/**
 * Find a service inside an app.
 *
 * @param {string} appId Koyeb app id.
 * @param {string} name Service name.
 * @returns {Promise<{ id: string, name: string } | undefined>} Matching service, if any.
 */
async function findService(appId, name) {
  const { services = [] } = await koyebRequest(
    `/services?app_id=${encodeURIComponent(appId)}&name=${encodeURIComponent(name)}`,
  );
  return services.find((service) => service.name === name);
}

/**
 * Collect optional runtime environment variables that are set in this workflow.
 *
 * @returns {Array<{ key: string, value: string }>} Koyeb environment entries.
 */
function buildEnvironment() {
  return OPTIONAL_ENV_VARS.filter((key) => process.env[key]).map((key) => ({
    key,
    value: process.env[key],
  }));
}

/**
 * Build the Koyeb deployment definition for the backend service.
 *
 * @returns {Record<string, unknown>} Deployment definition accepted by the Koyeb API.
 */
function buildDefinition() {
  const healthCheckPort = port;

  return {
    name: serviceName,
    type: "WEB",
    git: {
      repository,
      branch,
      workdir,
      // The workflow triggers deployments explicitly, so Koyeb must not auto-deploy on push.
      no_deploy_on_push: true,
      docker: { dockerfile },
    },
    ports: [{ port, protocol: "http" }],
    routes: [{ path: "/", port }],
    regions: [region],
    instance_types: [{ type: instanceType }],
    scalings: [{ min: 1, max: 1 }],
    health_checks: [
      {
        grace_period: 20,
        interval: 30,
        restart_limit: 3,
        timeout: 5,
        http: { path: "/healthz", port: healthCheckPort },
      },
    ],
    env: buildEnvironment(),
  };
}

/**
 * Wait until the deployment created by this run becomes healthy or fails.
 *
 * @param {string} serviceId Koyeb service id.
 * @param {string | null} previousDeploymentId Deployment id observed before the update.
 * @returns {Promise<{ id: string, status: string }>} Final deployment.
 */
async function waitForDeployment(serviceId, previousDeploymentId) {
  const deadline = Date.now() + deployTimeoutMs;
  let lastStatus = "UNKNOWN";
  let trackedDeploymentId = null;

  while (Date.now() < deadline) {
    const { service } = await koyebRequest(`/services/${serviceId}`);

    if (!trackedDeploymentId) {
      const latestDeploymentId = service.latest_deployment_id || service.active_deployment_id;

      // The previous deployment stays "latest" for a moment after the update,
      // so wait until Koyeb registers a deployment that is not the old one.
      if (!latestDeploymentId || latestDeploymentId === previousDeploymentId) {
        console.log("Waiting for Koyeb to register the new deployment...");
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        continue;
      }
      trackedDeploymentId = latestDeploymentId;
    }

    const { deployment } = await koyebRequest(`/deployments/${trackedDeploymentId}`);
    lastStatus = deployment.status || "UNKNOWN";

    if (lastStatus !== "UNKNOWN") {
      console.log(`Deployment ${trackedDeploymentId} status: ${lastStatus}`);
    }

    if (TERMINAL_SUCCESSES.has(lastStatus)) {
      return deployment;
    }
    if (TERMINAL_FAILURES.has(lastStatus)) {
      const messages = (deployment.messages || []).map((message) => message.text ?? message).join("; ");
      throw new Error(
        `Koyeb deployment ${trackedDeploymentId} failed with status ${lastStatus}${messages ? `: ${messages}` : "."}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timed out after ${deployTimeoutMs / 1000}s waiting for the Koyeb deployment (last status: ${lastStatus}).`);
}

/**
 * Resolve the public HTTPS URL of a Koyeb app.
 *
 * @param {string} appId Koyeb app id.
 * @returns {Promise<string | undefined>} Public URL when Koyeb has assigned a domain.
 */
async function resolveAppUrl(appId) {
  const { app } = await koyebRequest(`/apps/${appId}`);
  const domain = (app.domains || [])[0];

  if (!domain) {
    return undefined;
  }
  return `https://${domain.name ?? domain}`;
}

/**
 * Write the deployment result to the GitHub Actions job summary when available.
 *
 * @param {string[]} lines Markdown lines.
 * @returns {Promise<void>}
 */
async function writeJobSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) {
    return;
  }

  const { appendFile } = await import("node:fs/promises");
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

async function main() {
  const definition = buildDefinition();
  const app = await ensureApp(appName);
  const existingService = await findService(app.id, serviceName);

  let serviceId;
  const previousDeploymentId = existingService?.latest_deployment_id ?? null;

  if (existingService) {
    console.log(`Updating Koyeb service "${serviceName}" (${existingService.id}).`);
    const { service } = await koyebRequest(`/services/${existingService.id}`, {
      method: "PUT",
      body: { definition },
    });
    serviceId = service.id;
  } else {
    console.log(`Creating Koyeb service "${serviceName}" in app "${appName}".`);
    const { service } = await koyebRequest("/services", {
      method: "POST",
      body: { app_id: app.id, name: serviceName, definition },
    });
    serviceId = service.id;
  }

  const deployment = await waitForDeployment(serviceId, previousDeploymentId);
  const appUrl = await resolveAppUrl(app.id);

  console.log(`Koyeb deployment ${deployment.id} is ${deployment.status}.`);
  if (appUrl) {
    console.log(`Backend URL: ${appUrl}`);
  }

  await writeJobSummary([
    "## Koyeb backend deployment",
    "",
    `- App: \`${appName}\``,
    `- Service: \`${serviceName}\``,
    `- Deployment: \`${deployment.id}\` (${deployment.status})`,
    appUrl ? `- URL: ${appUrl}` : "- URL: not assigned yet",
    "",
    "Set the frontend `BACKEND_URL` (Vercel) or `config.json` `backendUrl` to the URL above.",
  ]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
