'use strict';

/**
 * GitHub REST API – GitHub's official public API.
 * Reference: https://docs.github.com/en/rest
 *
 * No credentials required for public data (read-only).
 * Rate limit: 60 req/hour unauthenticated; 5000/hour with a Personal Access Token.
 * Pass a token via `connection.user` (treated as a Bearer token by the REST driver).
 *
 * Relationship map:
 *  - /repos                → /users  (owner.login FK, belongsTo the owner)
 *  - /search/repositories  → /users  (owner.login FK, belongsTo the owner)
 *  - /users                → /repos  (login FK on repos, hasMany repos via
 *                                     /users/{login}/repos)
 *  - /orgs                 → /repos  (login FK on repos, hasMany repos via
 *                                     /orgs/{login}/repos)
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
      columns: ['id', 'name', 'full_name', 'description', 'html_url', 'language', 'forks_count', 'stargazers_count', 'watchers_count', 'open_issues_count', 'default_branch', 'created_at', 'updated_at', 'pushed_at', 'topics', 'visibility', 'owner'],
      relations: [
        { entity: '/users', foreignKey: 'owner.login', type: 'belongsTo', alias: 'owner' },
      ],
    },
    {
      name: '/orgs',
      columns: ['id', 'login', 'avatar_url', 'description', 'company', 'blog', 'location', 'email', 'public_repos', 'public_gists', 'followers', 'following', 'created_at', 'type'],
      relations: [],
    },
    {
      name: '/search/repositories',
      columns: ['id', 'name', 'full_name', 'description', 'language', 'stargazers_count', 'forks_count', 'open_issues_count', 'topics', 'html_url', 'owner'],
      relations: [
        { entity: '/users', foreignKey: 'owner.login', type: 'belongsTo', alias: 'owner' },
      ],
    },
  ],
};
