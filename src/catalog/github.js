'use strict';

/**
 * GitHub REST API – GitHub's official public API.
 * Reference: https://docs.github.com/en/rest
 *
 * No credentials required for public data (read-only).
 * Rate limit: 60 req/hour unauthenticated; 5000/hour with a Personal Access Token.
 * Pass a token via `connection.user` (treated as a Bearer token by the REST driver).
 *
 * Relationship notes:
 *  - Repos belong to a user/org: repos have `owner.login`.
 *  - Issues belong to a repo (use /repos/{owner}/{repo}/issues directly).
 *  - The REST driver resolves /users/{login} via the `login` foreign key.
 */
module.exports = {
  name: 'github',
  label: 'GitHub API (REST)',
  description: 'GitHub public REST API for users, repositories, issues, pull requests and organisations.',
  driver: 'rest',
  connection: {
    database: 'https://api.github.com',
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  },
  entities: [
    {
      name: '/users',
      columns: ['id', 'login', 'avatar_url', 'html_url', 'type', 'site_admin', 'repos_url', 'following', 'followers', 'public_repos', 'public_gists', 'created_at'],
      relations: [],
    },
    {
      name: '/repos',
      columns: ['id', 'name', 'full_name', 'description', 'html_url', 'language', 'forks_count', 'stargazers_count', 'watchers_count', 'open_issues_count', 'default_branch', 'created_at', 'updated_at', 'pushed_at', 'topics', 'visibility'],
      relations: [],
    },
    {
      name: '/orgs',
      columns: ['id', 'login', 'avatar_url', 'description', 'company', 'blog', 'location', 'email', 'public_repos', 'public_gists', 'followers', 'following', 'created_at', 'type'],
      relations: [],
    },
    {
      name: '/search/repositories',
      columns: ['id', 'name', 'full_name', 'description', 'language', 'stargazers_count', 'forks_count', 'open_issues_count', 'topics', 'html_url', 'owner'],
      relations: [],
    },
  ],
};
