/**
 * Neo4j Client
 *
 * Thin wrapper around the Neo4j JavaScript driver.
 * Connection is created lazily on first use and reused for the app lifetime.
 * All Neo4j features are disabled when NEO4J_URI is not set.
 */

import neo4j, { type Driver, type Session } from "neo4j-driver";

let _driver: Driver | null = null;

function getConfig() {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USERNAME ?? "neo4j";
  const password = process.env.NEO4J_PASSWORD ?? "";
  return { uri, user, password };
}

export function isNeo4jConfigured(): boolean {
  return !!process.env.NEO4J_URI;
}

export function getNeo4jDriver(): Driver {
  if (_driver) return _driver;

  const { uri, user, password } = getConfig();
  if (!uri) {
    throw new Error("[Neo4j] NEO4J_URI is not configured");
  }

  _driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
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
