import { dag, Container, Secret, object, func } from "@dagger.io/dagger"

const NODE_IMAGE = "node:26-bookworm-slim"
const DOCKER_HUB_REGISTRY = "docker.io"
const DOCKER_HUB_USERNAME = "florianherrengt"
const IMAGE_REPOSITORY = "docker.io/florianherrengt/rethinkloop"

const SOURCE_EXCLUDES = [
  "node_modules",
  "**/node_modules",
  ".git",
  "**/.git",
  "*.db",
  "*.db-shm",
  "*.db-wal",
  "dist",
  "**/dist",
  "coverage",
  "**/coverage",
  "test-results",
  "**/test-results",
  "playwright-report",
  "**/playwright-report",
  "storybook-static",
  "**/storybook-static",
  ".env",
  "**/.env",
  "coolify_token",
  "**/coolify_token",
  "**/*.kdbx",
  "src/api/secrets",
  "dagger",
  ".worktrees",
  ".playwright-mcp",
  ".codex",
  ".agents",
  ".code-review-graph",
]

/**
 * RethinkLoop CI pipeline: repository checks and production image builds.
 */
@object()
export class Rethinkloop {
  /**
   * Run the pre-PR gate: lint -> typecheck -> knip -> test.
   */
  @func()
  gatekeep(): Container {
    return this.buildEnv()
      .withExec(["npm", "run", "lint"])
      .withExec(["npm", "run", "typecheck"])
      .withExec(["npm", "run", "knip"])
      .withExec(["npm", "run", "test"])
  }

  /**
   * Lint the repository.
   */
  @func()
  lint(): Container {
    return this.buildEnv().withExec(["npm", "run", "lint"])
  }

  /**
   * Type-check the repository.
   */
  @func()
  typecheck(): Container {
    return this.buildEnv().withExec(["npm", "run", "typecheck"])
  }

  /**
   * Detect unused exports, files, and dependencies.
   */
  @func()
  knip(): Container {
    return this.buildEnv().withExec(["npm", "run", "knip"])
  }

  /**
   * Run API and web unit tests.
   */
  @func()
  test(): Container {
    return this.buildEnv().withExec(["npm", "run", "test"])
  }

  /**
   * Build the production image from the repository Dockerfile.
   */
  @func()
  image(): Container {
    return this.source().dockerBuild({ dockerfile: "Dockerfile" })
  }

  /**
   * Build the production image and push it to Docker Hub.
   *
   * Defaults to the "latest" tag. The Docker Hub token is read from the
   * DOCKER_HUB_TOKEN entry in the repository .env file unless a token
   * secret is passed explicitly.
   */
  @func()
  async publish(token?: Secret, tag?: string): Promise<string> {
    const secret = token ?? (await this.dockerHubTokenFromDotenv())
    const versionTag = tag ?? "latest"
    return this.image()
      .withRegistryAuth(DOCKER_HUB_REGISTRY, DOCKER_HUB_USERNAME, secret)
      .publish(`${IMAGE_REPOSITORY}:${versionTag}`)
  }

  /**
   * Repository source with dependencies installed, mirroring the
   * Dockerfile build stage (manifests copied first for cache reuse).
   */
  private buildEnv(): Container {
    const src = this.source()
    const manifests = dag
      .directory()
      .withFile("package.json", src.file("package.json"))
      .withFile("package-lock.json", src.file("package-lock.json"))
      .withFile("src/api/package.json", src.file("src/api/package.json"))
      .withFile("src/web/package.json", src.file("src/web/package.json"))

    return dag
      .container()
      .from(NODE_IMAGE)
      .withWorkdir("/app")
      // CI has no browser; the API's screenshot tests mock Puppeteer.
      .withEnvVariable("PUPPETEER_SKIP_DOWNLOAD", "true")
      .withDirectory(".", manifests)
      .withMountedCache("/root/.npm", dag.cacheVolume("npm-cache"))
      .withExec(["npm", "ci"])
      .withDirectory(".", src)
  }

  private source() {
    return dag.currentWorkspace().directory(".", {
      exclude: SOURCE_EXCLUDES,
      gitignore: true,
    })
  }

  private async dockerHubTokenFromDotenv(): Promise<Secret> {
    const dotenv = await dag.currentWorkspace().file(".env").contents()
    const match = /^DOCKER_HUB_TOKEN=(.*)$/m.exec(dotenv)
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? ""
    if (!value) {
      throw new Error(
        "DOCKER_HUB_TOKEN is missing from .env; add it or pass a token secret",
      )
    }
    return dag.setSecret("docker-hub-token", value)
  }
}
