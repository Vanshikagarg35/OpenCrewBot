---
name: Code Review
keywords: code, review, repository, repo, github, bug, refactor, pull request, pr, technical, development
kind: code
---
# Code Review

Check these:
1. Project structure and README (can a new dev run it?)
2. Dependencies - outdated or unused
3. Security - secrets in code, missing input validation
4. Tests - are there any tests
5. Open issues and how old they are
6. Code smells - very long files, duplicate code

Output:
- Issues found (with file/path if known)
- Priority: High / Medium / Low
- Proposed change for each
- Development plan (week by week)
Any change to the repo (issue, PR, commit) needs human approval first.
