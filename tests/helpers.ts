import { type GitHubLabel, type LabelService } from "#github/client.js";
import { type LabelSpec, normalizeColor } from "#core/labels.js";

export function makeGitHubLabel(
  name: string,
  color: string,
  description: string | null = null,
): GitHubLabel {
  return { name, color, description };
}

export function makeLabelSpec(name: string, color: string, description?: string): LabelSpec {
  return { name, color, ...(description !== undefined && { description }) };
}

/** In-memory label store for happy-path tests. */
export class MockLabelService implements LabelService {
  labels: GitHubLabel[];

  constructor(initial: GitHubLabel[] = []) {
    this.labels = [...initial];
  }

  listLabels(): Promise<GitHubLabel[]> {
    return Promise.resolve([...this.labels]);
  }

  createLabel(spec: LabelSpec): Promise<void> {
    this.labels.push({
      name: spec.name,
      color: normalizeColor(spec.color),
      description: spec.description ?? null,
    });
    return Promise.resolve();
  }

  updateLabel(currentName: string, spec: LabelSpec): Promise<void> {
    this.labels = this.labels.filter((label) => label.name !== currentName);
    return this.createLabel(spec);
  }

  deleteLabel(name: string): Promise<void> {
    this.labels = this.labels.filter((label) => label.name !== name);
    return Promise.resolve();
  }
}

/** Every mutation fails; used for error-path tests. */
export class FailingLabelService implements LabelService {
  private readonly labels: GitHubLabel[];

  constructor(labels: GitHubLabel[] = []) {
    this.labels = labels;
  }

  listLabels(): Promise<GitHubLabel[]> {
    return Promise.resolve([...this.labels]);
  }

  createLabel(): Promise<void> {
    return Promise.reject(new Error("mock create error"));
  }

  updateLabel(): Promise<void> {
    return Promise.reject(new Error("mock update error"));
  }

  deleteLabel(): Promise<void> {
    return Promise.reject(new Error("mock delete error"));
  }
}
