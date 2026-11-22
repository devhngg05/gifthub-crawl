export interface GitHubRepoItem {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  pushed_at: string;
  archived: boolean;
  topics: string[];
}

export interface CleanReadmeResult {
  sha: string | null;
  text: string;
}

export async function fetchCandidateRepos(): Promise<GitHubRepoItem[]> {
  return [];
}

export async function fetchCleanReadme(
  fullName: string,
): Promise<CleanReadmeResult> {
  void fullName;
  return { sha: null, text: "" };
}
