/**
 * Neo4j Client
 *
 * Thin wrapper around the Neo4j JavaScript driver. Configuration is injected
 * by the hosting app (typically createEngine) via configureNeo4j; the driver
 * is then created lazily on first use and reused for the process lifetime.
 *
 * Legacy callers that do not pass config explicitly continue to work when the
 * app has already called configureNeo4j during startup. Calling a driver
 * accessor before configureNeo4j has been called throws, so the host app
 * must wire this up early (see apps/web/src/server/engine.ts).
 */

import neo4j, { type Driver, type Session } from "neo4j-driver";

export interface Neo4jClientConfig {
  uri: string;
  user: string;
  password: string;
}

let _driver: Driver | null = null;
let _config: Neo4jClientConfig | null = null;

/**
 * Inject Neo4j credentials. Idempotent — calling with the same config is a
 * no-op; calling with a different config closes the previous driver so the
 * next getNeo4jDriver() call rebuilds against the new credentials. Pass
 * `null` to mark Neo4j as unconfigured (disables graph-dependent features).
 */
export function configureNeo4j(config: Neo4jClientConfig | null): void {
  if (_config && config && _config.uri === config.uri && _config.user === config.user && _config.password === config.password) {
    return;
  }
  if (_driver) {
    void _driver.close();
    _driver = null;
  }
  _config = config;
}

export function isNeo4jConfigured(): boolean {
  return !!_config;
}

export function getNeo4jDriver(): Driver {
  if (_driver) return _driver;

  if (!_config) {
    throw new Error(
      "[Neo4j] Not configured. The host must call configureNeo4j({ uri, user, password }) during startup.",
    );
  }

  _driver = neo4j.driver(
    _config.uri,
    neo4j.auth.basic(_config.user, _config.password),
  );
  return _driver;
}

export function getNeo4jSession(): Session {
  return getNeo4jDriver().session();
}

export async function checkNeo4jHealth(): Promise<boolean> {
  if (!isNeo4jConfigured()) return false;

  let session: Session | null = null;
  try {
    session = getNeo4jSession();
    await session.run("RETURN 1");
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      "[Neo4j] Health check failed:",
      error instanceof Error ? error.message : error,
    );
    return false;
  } finally {
    await session?.close();
  }
}

export async function closeNeo4jDriver(): Promise<void> {
  if (_driver) {
    await _driver.close();
    _driver = null;
  }
}

/** Re-export Driver / Session types so callers do not need to depend directly on neo4j-driver. */
export type { Driver, Session };
