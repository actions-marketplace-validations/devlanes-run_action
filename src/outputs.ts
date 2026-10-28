// Maps the JSON that devlanes prints into the action's outputs. Only the fields the outputs use
// are typed; the daemon sends more.

/** One unit of `devlanes status --json`. */
export interface UnitSummary {
  name: string;
  state: string;
  kind?: string;
  ports?: Record<string, number>;
  urls?: string[];
  public_url?: string | null;
  exit_code?: number | null;
}

/** One container of `devlanes status --json`. */
export interface ContainerSummary {
  name: string;
  state?: string;
  shared?: boolean;
  ports?: Record<string, number>;
  urls?: string[];
}

/** One lane of `devlanes status --json`. */
export interface LaneSummary {
  reference: string;
  index: number | null;
  domain?: string | null;
  units?: UnitSummary[];
  containers?: ContainerSummary[];
}

/** `devlanes status --json`. */
export interface StatusPage {
  items: LaneSummary[];
}

/** `devlanes env show --json` without a unit. */
export interface LaneEnv {
  lane: string;
  env: Record<string, string>;
}

/** The proxy part of `devlanes url ls --json`. */
export interface HostsPage {
  proxy?: { https?: { bound?: boolean; port?: number | null } };
}

/** A service in the `services` output. */
export interface ServiceOutput {
  state: string;
  kind: string;
  port: number | null;
  ports: Record<string, number>;
  url: string | null;
  public_url: string | null;
  urls: string[];
}

/** A container in the `infra` output. */
export interface ContainerOutput {
  state: string | null;
  shared: boolean;
  ports: Record<string, number>;
  urls: string[];
}

/** Kinds that a test can send requests to; tasks and exec units come and go. */
const reachable = new Set(['service', 'external']);

/** Services of a lane by name, with the loopback URL next to the public one. */
export function serviceOutputs(lane: LaneSummary): Record<string, ServiceOutput> {
  const services: Record<string, ServiceOutput> = {};
  for (const unit of lane.units ?? []) {
    const kind = unit.kind ?? 'service';
    if (!reachable.has(kind)) continue;
    const ports = unit.ports ?? {};
    const port = ports.default ?? Object.values(ports)[0] ?? null;
    services[unit.name] = {
      state: unit.state,
      kind,
      port,
      ports,
      url: port === null ? null : `http://127.0.0.1:${port}`,
      public_url: unit.public_url ?? null,
      urls: unit.urls ?? []
    };
  }
  return services;
}

/**
 * The URL a test should use for each service: the public one through the proxy when the service
 * has hostnames, else its loopback URL, the same rule as `DEVLANES_PUBLIC_URL_<SERVICE>`.
 */
export function urlOutputs(services: Record<string, ServiceOutput>): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const [name, service] of Object.entries(services)) {
    const url = service.public_url ?? service.url;
    if (url) urls[name] = url;
  }
  return urls;
}

/** Containers of a lane by name. */
export function infraOutputs(lane: LaneSummary): Record<string, ContainerOutput> {
  const infra: Record<string, ContainerOutput> = {};
  for (const container of lane.containers ?? []) {
    infra[container.name] = {
      state: container.state ?? null,
      shared: container.shared ?? false,
      ports: container.ports ?? {},
      urls: container.urls ?? []
    };
  }
  return infra;
}

/** The port the HTTPS proxy listens on, or null when it is not bound. */
export function httpsPort(hosts: HostsPage): number | null {
  const https = hosts.proxy?.https;
  return https?.bound && typeof https.port === 'number' ? https.port : null;
}

/** Names of the lane's units that failed. */
export function failedUnits(lane: LaneSummary | undefined): string[] {
  return (lane?.units ?? []).filter((unit) => unit.state === 'failed').map((unit) => unit.name);
}
