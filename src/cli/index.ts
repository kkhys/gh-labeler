#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { Command, Option } from "commander";
import pc from "picocolors";
import {
  CONVENTION_CONFIG_FILES,
  fetchRemoteConfig,
  findConventionConfig,
  type LabelConfigFile,
  loadConfigFile,
  loadConfigFromStdin,
  parseRemoteConfigRef,
  serializeConfigDocument,
} from "#config/index.js";
import { resolveRepository, resolveToken } from "#github/context.js";
import { ConfigError, EXIT_CODES, toGhLabelerError } from "#errors.js";
import { GitHubClient } from "#github/client.js";
import { defaultLabels, type LabelSpec } from "#core/labels.js";
import { type PlanResult, planSync } from "#core/planner.js";
import { renderPlan, renderResult } from "#output/render.js";
import { errorEnvelope, REPORT_SCHEMA_VERSION, reportEnvelope } from "#output/report.js";
import { applyPlan, buildReport, hasChanges } from "#core/syncer.js";
import { VERSION } from "#version.js";

interface CommonOptions {
  token?: string;
  json?: boolean;
}

interface ConfigOptions {
  config?: string;
  from?: string;
  /** True from --prune, false from --no-prune, undefined when neither is given. */
  prune?: boolean;
  /** Set to false by --no-similarity; commander defaults it to true. */
  similarity?: boolean;
}

interface SyncOptions extends CommonOptions, ConfigOptions {
  dryRun?: boolean;
  yes?: boolean;
}

interface PlanCommandOptions extends SyncOptions {
  check?: boolean;
}

interface ValidateOptions {
  config?: string;
  json?: boolean;
}

function compareByName(a: { name: string }, b: { name: string }): number {
  if (a.name < b.name) {
    return -1;
  }
  if (a.name > b.name) {
    return 1;
  }
  return 0;
}

/** Progress notes go to stderr so stdout stays clean for pipes and --json. */
function note(json: boolean | undefined, message: string): void {
  if (!json) {
    console.error(pc.dim(message));
  }
}

async function run(command: string, json: boolean, fn: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await fn();
  } catch (error) {
    const failure = toGhLabelerError(error);
    if (json) {
      console.log(JSON.stringify(errorEnvelope(command, failure), null, 2));
    } else {
      console.error(pc.red(`error: ${failure.message}`));
      if (failure.hint) {
        console.error(pc.dim(`hint: ${failure.hint}`));
      }
    }
    process.exitCode = failure.exitCode;
  }
}

function loadLocalConfig(configOption: string | undefined): {
  config: LabelConfigFile;
  source: string;
} {
  if (configOption === "-") {
    return { config: loadConfigFromStdin(), source: "stdin" };
  }
  if (configOption) {
    return { config: loadConfigFile(configOption), source: configOption };
  }
  const conventionPath = findConventionConfig(process.cwd());
  if (!conventionPath) {
    throw new ConfigError(
      "No label config found",
      `Searched for: ${CONVENTION_CONFIG_FILES.join(", ")}. Run \`gh-labeler init\` to create one, or pass --config.`,
    );
  }
  return { config: loadConfigFile(conventionPath), source: conventionPath };
}

interface PreparedPlan {
  client: GitHubClient;
  repository: string;
  plan: PlanResult;
}

async function preparePlan(repoArg: string | undefined, opts: SyncOptions): Promise<PreparedPlan> {
  if (opts.config !== undefined && opts.from !== undefined) {
    throw new ConfigError(
      "--config and --from cannot be combined",
      "Use --config for a local file or --from for a remote repository, not both.",
    );
  }

  const token = resolveToken(opts.token);
  const repository = resolveRepository(repoArg);

  // Load local config before any network call so config mistakes fail fast.
  let config: LabelConfigFile | null = null;
  if (!opts.from) {
    const { config: localConfig, source } = loadLocalConfig(opts.config);
    config = localConfig;
    note(opts.json, `Config: ${source}`);
  }

  const client = await GitHubClient.connect(token, repository);

  if (opts.from) {
    const ref = parseRemoteConfigRef(opts.from);
    config = await fetchRemoteConfig(client, ref);
    note(opts.json, `Config: ${opts.from} (remote)`);
  }

  if (!config) {
    throw new ConfigError("No label config resolved");
  }

  const current = await client.listLabels();
  const prune = opts.prune ?? config.prune ?? false;
  const plan = planSync(current, config.labels, {
    prune,
    similarity: opts.similarity ?? true,
  });
  return { client, repository, plan };
}

async function confirmDeletions(count: number): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(
      pc.yellow(`This will delete ${count} label(s). Continue? [y/N] `),
    );
    return /^y(?:es)?$/iu.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function planAction(repoArg: string | undefined, opts: PlanCommandOptions): Promise<number> {
  const { repository, plan } = await preparePlan(repoArg, opts);
  let report = buildReport({ repository, plan, failures: [], dryRun: true });
  if (opts.check && hasChanges(report.summary)) {
    report = { ...report, exitCode: EXIT_CODES.DRIFT };
  }

  if (opts.json) {
    console.log(JSON.stringify(reportEnvelope("plan", report), null, 2));
  } else {
    console.log(renderPlan(report).join("\n"));
  }
  return report.exitCode;
}

function validateAction(opts: ValidateOptions): Promise<number> {
  const { config, source } = loadLocalConfig(opts.config);
  const prune = config.prune ?? false;

  if (opts.json) {
    const envelope = {
      schema_version: REPORT_SCHEMA_VERSION,
      command: "validate",
      status: "success",
      exit_code: EXIT_CODES.SUCCESS,
      config_source: source,
      label_count: config.labels.length,
      prune,
    };
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    console.log(
      `${pc.green("✔")} ${pc.bold(source)} is valid: ${config.labels.length} label(s), prune ${
        prune ? "on" : "off"
      }.`,
    );
  }
  return Promise.resolve(EXIT_CODES.SUCCESS);
}

async function syncAction(repoArg: string | undefined, opts: SyncOptions): Promise<number> {
  const { client, repository, plan } = await preparePlan(repoArg, opts);
  const dryRun = opts.dryRun ?? false;

  if (opts.json) {
    // JSON mode is non-interactive by design: agents and CI get one envelope.
    const failures = await applyPlan(client, plan.operations, { dryRun });
    const report = buildReport({ repository, plan, failures, dryRun });
    console.log(JSON.stringify(reportEnvelope("sync", report), null, 2));
    return report.exitCode;
  }

  const planReport = buildReport({
    repository,
    plan,
    failures: [],
    dryRun: true,
  });
  console.log(renderPlan(planReport).join("\n"));

  if (!hasChanges(planReport.summary) || dryRun) {
    return EXIT_CODES.SUCCESS;
  }

  const deletions = plan.operations.filter((op) => op.type === "delete").length;
  const interactive = process.stdin.isTTY === true && process.stderr.isTTY === true;
  if (deletions > 0 && !opts.yes && interactive && !(await confirmDeletions(deletions))) {
    console.error("Aborted. No changes were made.");
    return EXIT_CODES.GENERAL_ERROR;
  }

  console.log("");
  const failures = await applyPlan(client, plan.operations, { dryRun: false });
  const report = buildReport({ repository, plan, failures, dryRun: false });
  console.log(renderResult(report).join("\n"));
  return report.exitCode;
}

async function listAction(repoArg: string | undefined, opts: CommonOptions): Promise<number> {
  const token = resolveToken(opts.token);
  const repository = resolveRepository(repoArg);
  const client = await GitHubClient.connect(token, repository);
  const labels = await client.listLabels();
  labels.sort(compareByName);

  if (opts.json) {
    const envelope = {
      schema_version: REPORT_SCHEMA_VERSION,
      command: "list",
      repository,
      status: "success",
      exit_code: EXIT_CODES.SUCCESS,
      labels: labels.map((label) => ({
        name: label.name,
        color: `#${label.color}`,
        description: label.description,
      })),
    };
    console.log(JSON.stringify(envelope, null, 2));
    return EXIT_CODES.SUCCESS;
  }

  if (labels.length === 0) {
    console.log(pc.dim(`No labels in ${repository}.`));
    return EXIT_CODES.SUCCESS;
  }

  const nameWidth = Math.max(...labels.map((label) => label.name.length), 4);
  console.log(
    `${pc.bold("NAME".padEnd(nameWidth))}  ${pc.bold("COLOR")}    ${pc.bold("DESCRIPTION")}`,
  );
  for (const label of labels) {
    const description = label.description ?? pc.dim("(none)");
    console.log(`${label.name.padEnd(nameWidth)}  #${label.color}  ${description}`);
  }
  return EXIT_CODES.SUCCESS;
}

interface ExportOptions extends CommonOptions {
  format: "yaml" | "json";
  output?: string;
  force?: boolean;
}

function githubLabelsToSpecs(
  labels: { name: string; color: string; description: string | null }[],
): LabelSpec[] {
  return labels.map((label) => ({
    name: label.name,
    color: `#${label.color.toLowerCase()}`,
    ...(label.description !== null &&
      label.description !== "" && { description: label.description }),
  }));
}

async function exportAction(repoArg: string | undefined, opts: ExportOptions): Promise<number> {
  const token = resolveToken(opts.token);
  const repository = resolveRepository(repoArg);
  const client = await GitHubClient.connect(token, repository);
  const labels = await client.listLabels();
  labels.sort(compareByName);

  const specs = githubLabelsToSpecs(labels);
  const document = serializeConfigDocument(specs, opts.format);

  if (opts.output) {
    writeDocument(opts.output, document, opts.force ?? false);
  }

  if (opts.json) {
    const envelope = {
      schema_version: REPORT_SCHEMA_VERSION,
      command: "export",
      repository,
      status: "success",
      exit_code: EXIT_CODES.SUCCESS,
      labels: specs,
      ...(opts.output !== undefined && { output: opts.output }),
    };
    console.log(JSON.stringify(envelope, null, 2));
  } else if (opts.output) {
    console.error(`Exported ${labels.length} labels from ${repository} to ${opts.output}`);
  } else {
    process.stdout.write(document);
  }
  return EXIT_CODES.SUCCESS;
}

interface InitOptions {
  format: "yaml" | "json";
  output?: string;
  force?: boolean;
}

function writeDocument(path: string, content: string, force: boolean): void {
  if (existsSync(path) && !force) {
    throw new ConfigError(`File already exists: ${path}`, "Pass --force to overwrite it.");
  }
  const dir = dirname(path);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, content);
}

function initAction(opts: InitOptions): Promise<number> {
  const output =
    opts.output ?? (opts.format === "json" ? ".github/labels.json" : ".github/labels.yml");
  const document = serializeConfigDocument(defaultLabels(), opts.format);
  writeDocument(output, document, opts.force ?? false);

  console.log(
    `${pc.green("✔")} Created ${pc.bold(output)} with ${defaultLabels().length} starter labels.`,
  );
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Edit ${output} to declare your label set.`);
  console.log(`  2. Preview changes:  ${pc.cyan("gh-labeler plan")}`);
  console.log(`  3. Apply changes:    ${pc.cyan("gh-labeler sync")}`);
  console.log("");
  console.log(
    pc.dim(
      `Tip: start from an existing repository with \`gh-labeler export owner/repo -o ${
        output
      } --force\`.`,
    ),
  );
  return Promise.resolve(EXIT_CODES.SUCCESS);
}

function schemaAction(): Promise<number> {
  const schemaPath = new URL("../../schema/labels.schema.json", import.meta.url);
  process.stdout.write(readFileSync(schemaPath, "utf8"));
  return Promise.resolve(EXIT_CODES.SUCCESS);
}

function withCommonOptions(command: Command): Command {
  return command
    .option("--token <token>", "GitHub token (default: GITHUB_TOKEN → GH_TOKEN → `gh auth token`)")
    .option("--json", "print a machine-readable JSON envelope to stdout");
}

function withConfigOptions(command: Command): Command {
  return command
    .option(
      "-c, --config <path>",
      'label config file (JSON/YAML); "-" reads stdin (default: convention files)',
    )
    .option("--from <repo[:path]>", "load the label config from another repository")
    .option("--prune", "delete repository labels that are not declared in the config")
    .option("--no-prune", "keep undeclared labels even when the config sets prune: true")
    .option("--no-similarity", "disable similarity-based rename detection (aliases still match)");
}

function withRepoArgument(command: Command): Command {
  return command.argument(
    "[repo]",
    "target repository as owner/repo (default: GITHUB_REPOSITORY or the origin git remote)",
  );
}

const program = new Command();

program
  .name("gh-labeler")
  .description("Declarative GitHub label management for humans and AI agents")
  .version(VERSION, "-v, --version");

withConfigOptions(
  withCommonOptions(
    withRepoArgument(
      program.command("plan").description("preview the changes sync would make (read-only)"),
    ),
  ),
)
  .option("--check", "exit with code 6 when changes are pending (CI drift detection)")
  .action(async (repoArg: string | undefined, opts: PlanCommandOptions) => {
    await run("plan", opts.json ?? false, () => planAction(repoArg, opts));
  });

withConfigOptions(
  withCommonOptions(
    withRepoArgument(program.command("sync").description("apply the label config to a repository")),
  ),
)
  .option("--dry-run", "plan only; make no changes")
  .option("-y, --yes", "skip the confirmation prompt for deletions")
  .action(async (repoArg: string | undefined, opts: SyncOptions) => {
    await run("sync", opts.json ?? false, () => syncAction(repoArg, opts));
  });

program
  .command("validate")
  .description("validate the label config offline (no network, no token needed)")
  .option(
    "-c, --config <path>",
    'label config file (JSON/YAML); "-" reads stdin (default: convention files)',
  )
  .option("--json", "print a machine-readable JSON envelope to stdout")
  .action(async (opts: ValidateOptions) => {
    await run("validate", opts.json ?? false, () => validateAction(opts));
  });

withCommonOptions(
  withRepoArgument(
    program.command("list").description("show the labels currently on a repository"),
  ),
).action(async (repoArg: string | undefined, opts: CommonOptions) => {
  await run("list", opts.json ?? false, () => listAction(repoArg, opts));
});

withCommonOptions(
  withRepoArgument(
    program
      .command("export")
      .description("export current repository labels as a config file (adopt a repo in one step)"),
  ),
)
  .addOption(
    new Option("--format <format>", "output format").choices(["yaml", "json"]).default("yaml"),
  )
  .option("-o, --output <path>", "write to a file instead of stdout")
  .option("--force", "overwrite an existing file")
  .action(async (repoArg: string | undefined, opts: ExportOptions) => {
    await run("export", opts.json ?? false, () => exportAction(repoArg, opts));
  });

program
  .command("init")
  .description("create a starter label config (.github/labels.yml)")
  .addOption(
    new Option("--format <format>", "config format").choices(["yaml", "json"]).default("yaml"),
  )
  .option("-o, --output <path>", "config file path (default: .github/labels.yml)")
  .option("--force", "overwrite an existing file")
  .action(async (opts: InitOptions) => {
    await run("init", false, () => initAction(opts));
  });

program
  .command("schema")
  .description("print the JSON Schema for label config files")
  .action(async () => {
    await run("schema", false, () => schemaAction());
  });

program.addHelpText(
  "after",
  `
Examples:
  gh-labeler init                       create .github/labels.yml with starter labels
  gh-labeler validate                   check the config offline, no token needed
  gh-labeler plan                       preview changes for the current repository
  gh-labeler plan --check               CI drift gate: exit 6 when labels differ
  gh-labeler sync                       apply the config (asks before deleting)
  gh-labeler sync --prune --yes         full sync in CI, no prompt
  gh-labeler sync --json                machine-readable result for scripts and agents
  gh-labeler export other/repo          print another repository's labels as config
  gh-labeler sync --from org/labels     sync using a config kept in a central repo
  cat labels.json | gh-labeler plan -c -   read the config from stdin

Exit codes:
  0 success · 1 general error · 2 config error · 3 auth error · 4 repo not found · 5 partial failure · 6 drift (plan --check)

Docs for AI agents: https://github.com/kkhys/gh-labeler/blob/main/AGENTS.md`,
);

await program.parseAsync(process.argv);
