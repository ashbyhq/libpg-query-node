window.BENCHMARK_DATA = {
  "lastUpdate": 1787098173831,
  "repoUrl": "https://github.com/ashbyhq/libpg-query-node",
  "entries": {
    "native libpg-query (linux-x64, jemalloc)": [
      {
        "commit": {
          "author": {
            "email": "41898282+github-actions[bot]@users.noreply.github.com",
            "name": "github-actions[bot]",
            "username": "github-actions[bot]"
          },
          "committer": {
            "email": "jeff@ashbyhq.com",
            "name": "Jeff Lubetkin",
            "username": "jefflub-ashby"
          },
          "distinct": true,
          "id": "136432f3d9989a8b08978319de247ff4cec89879",
          "message": "native: publish via npm trusted publishing instead of a token\n\nThe release workflow referenced secrets.NPM_TOKEN, but the repo has no\nsecrets at all — repo or org. It has never run, and no native-v* tag\nexists: the published 0.1.1-beta.0 was pushed by hand from a laptop. So\nthe publish path was never going to work as written.\n\nRather than add a long-lived credential to something entering a production\ndependency chain, authenticate with OIDC. npm verifies the workflow's\nidentity directly, there is nothing to leak or rotate, and provenance\nattestations are generated automatically.\n\n- publish job gains id-token: write; both NODE_AUTH_TOKEN entries are gone.\n  registry-url stays — it tells npm which registry verifies the token.\n- Asserts npm >= 11.5.1 before publishing. Node 24.0.0 shipped npm 11.3.0\n  and `node-version: 24` floats to the newest 24.x, so this should not be\n  left to chance in a workflow that publishes.\n- The platform-package loop now skips any package already published at the\n  target version. Each of the six packages carries its own trusted-publisher\n  config, so a single bad config fails one publish mid-loop; without this a\n  re-run would die on EPUBLISHCONFLICT for an earlier package instead of\n  completing. The main package still publishes last, so a partial failure\n  never advertises platform packages that do not exist.\n\nREADME documents the six configs, the required fields, and the npm version\nfloor.\n\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>",
          "timestamp": "2026-08-10T12:32:12-07:00",
          "tree_id": "c42b20fc792cb482c90e9d249c607cc181e196f4",
          "url": "https://github.com/ashbyhq/libpg-query-node/commit/136432f3d9989a8b08978319de247ff4cec89879"
        },
        "date": 1786390403981,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Large query parse time",
            "value": 1147.3,
            "unit": "ms"
          },
          {
            "name": "Large query peak RSS",
            "value": 453.3,
            "unit": "MB"
          },
          {
            "name": "Large query retained RSS",
            "value": 294.8,
            "unit": "MB"
          },
          {
            "name": "Small query latency",
            "value": 14.84,
            "unit": "us/parse"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "41898282+github-actions[bot]@users.noreply.github.com",
            "name": "github-actions[bot]",
            "username": "github-actions[bot]"
          },
          "committer": {
            "email": "jeff@ashbyhq.com",
            "name": "Jeff Lubetkin",
            "username": "jefflub-ashby"
          },
          "distinct": false,
          "id": "136432f3d9989a8b08978319de247ff4cec89879",
          "message": "native: publish via npm trusted publishing instead of a token\n\nThe release workflow referenced secrets.NPM_TOKEN, but the repo has no\nsecrets at all — repo or org. It has never run, and no native-v* tag\nexists: the published 0.1.1-beta.0 was pushed by hand from a laptop. So\nthe publish path was never going to work as written.\n\nRather than add a long-lived credential to something entering a production\ndependency chain, authenticate with OIDC. npm verifies the workflow's\nidentity directly, there is nothing to leak or rotate, and provenance\nattestations are generated automatically.\n\n- publish job gains id-token: write; both NODE_AUTH_TOKEN entries are gone.\n  registry-url stays — it tells npm which registry verifies the token.\n- Asserts npm >= 11.5.1 before publishing. Node 24.0.0 shipped npm 11.3.0\n  and `node-version: 24` floats to the newest 24.x, so this should not be\n  left to chance in a workflow that publishes.\n- The platform-package loop now skips any package already published at the\n  target version. Each of the six packages carries its own trusted-publisher\n  config, so a single bad config fails one publish mid-loop; without this a\n  re-run would die on EPUBLISHCONFLICT for an earlier package instead of\n  completing. The main package still publishes last, so a partial failure\n  never advertises platform packages that do not exist.\n\nREADME documents the six configs, the required fields, and the npm version\nfloor.\n\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>",
          "timestamp": "2026-08-10T12:32:12-07:00",
          "tree_id": "c42b20fc792cb482c90e9d249c607cc181e196f4",
          "url": "https://github.com/ashbyhq/libpg-query-node/commit/136432f3d9989a8b08978319de247ff4cec89879"
        },
        "date": 1786390487560,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Large query parse time",
            "value": 1167.1,
            "unit": "ms"
          },
          {
            "name": "Large query peak RSS",
            "value": 453.5,
            "unit": "MB"
          },
          {
            "name": "Large query retained RSS",
            "value": 294.8,
            "unit": "MB"
          },
          {
            "name": "Small query latency",
            "value": 15.711,
            "unit": "us/parse"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "41898282+github-actions[bot]@users.noreply.github.com",
            "name": "github-actions[bot]",
            "username": "github-actions[bot]"
          },
          "committer": {
            "email": "jeff@ashbyhq.com",
            "name": "Jeff Lubetkin",
            "username": "jefflub-ashby"
          },
          "distinct": true,
          "id": "7c658cc6c1cedd19f3f2eb43dd8a00e42c81ea6c",
          "message": "native: release 0.1.1\n\nFirst stable release. 0.1.1-beta.0 was published by hand; this is the first\ncut through the automated path, and the first to carry npm provenance.\n\nAlso moves the `latest` dist-tag off a prerelease — it currently points at\n0.1.1-beta.0, which `npm install @ashbyhq/libpg-query-native` resolves to\ntoday. The workflow derives `latest` for any non-prerelease version, so\npublishing this corrects it.\n\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>",
          "timestamp": "2026-08-10T12:51:36-07:00",
          "tree_id": "c855a5b7f439746ee438fd310f8ad0ceea05f955",
          "url": "https://github.com/ashbyhq/libpg-query-node/commit/7c658cc6c1cedd19f3f2eb43dd8a00e42c81ea6c"
        },
        "date": 1786391584636,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Large query parse time",
            "value": 1164,
            "unit": "ms"
          },
          {
            "name": "Large query peak RSS",
            "value": 449,
            "unit": "MB"
          },
          {
            "name": "Large query retained RSS",
            "value": 294.6,
            "unit": "MB"
          },
          {
            "name": "Small query latency",
            "value": 14.901,
            "unit": "us/parse"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jeff@ashbyhq.com",
            "name": "Jeff Lubetkin",
            "username": "jefflub-ashby"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "e8726cf12c25207fd0e19f88b092538e04489f84",
          "message": "Merge pull request #5 from ashbyhq/benasher44/deparse-native\n\nnative: add deparse",
          "timestamp": "2026-08-18T17:08:04-07:00",
          "tree_id": "04b7ca6042013f15400fa53600bc9425a329758e",
          "url": "https://github.com/ashbyhq/libpg-query-node/commit/e8726cf12c25207fd0e19f88b092538e04489f84"
        },
        "date": 1787098172840,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Large query parse time",
            "value": 1157.1,
            "unit": "ms"
          },
          {
            "name": "Large query peak RSS",
            "value": 456.1,
            "unit": "MB"
          },
          {
            "name": "Large query retained RSS",
            "value": 286.6,
            "unit": "MB"
          },
          {
            "name": "Small query latency",
            "value": 14.788,
            "unit": "us/parse"
          }
        ]
      }
    ]
  }
}