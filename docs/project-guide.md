## Product Requirements Document (PRD): Sentrypede

**1. Introduction**

Dovetail.com is committed to maintaining a high-quality codebase and ensuring a reliable user experience. Currently, Sentry alerts require manual intervention from engineers, consuming valuable time that could be spent on feature development. To streamline this process and improve developer productivity, we propose building "Sentrypede," an automated agent and Slack bot that monitors Sentry, identifies actionable errors, and attempts to fix them using AI, culminating in a pull request for human review.

**2. Problem Statement**

Manual handling of Sentry error alerts is time-consuming, reactive, and can lead to delays in fixing bugs. This impacts developer velocity and can potentially affect application stability. We need a system that can proactively identify and attempt to resolve common or straightforward code errors, reducing the manual burden and speeding up the feedback loop.

**3. Goals & Objectives**

  * **Goal:** Significantly reduce the time and effort required to address Sentry error alerts.
  * **Objective 1:** Automate the detection of new, relevant Sentry errors.
  * **Objective 2:** Implement an AI-driven workflow to automatically generate code fixes for identified Sentry errors.
  * **Objective 3:** Automate the creation of unit tests to validate the generated fixes.
  * **Objective 4:** Streamline the code review process by automatically creating GitHub Pull Requests for proposed fixes.
  * **Objective 5:** Keep the engineering team informed via Slack throughout the process.

**4. Target Audience**

The primary users of Sentrypede will be the Engineering team at Dovetail.com. The system will primarily operate autonomously, but engineers will interact with its outputs (Slack notifications and GitHub PRs).

**5. Naming**

The official name for this project and the resulting bot/agent will be **Sentrypede**, playing on "Sentry" and the image of a many-legged creature quickly tackling numerous issues (bugs).

**6. Key Features & Workflow**

Sentrypede will operate through the following automated workflow:

**6.1. Sentry Monitoring**

  * **Requirement:** The agent must securely connect to the Dovetail Sentry instance via its API.
  * **Requirement:** It must monitor for *new* Sentry issues or a significant increase in the frequency of *existing* issues (configurability needed here - e.g., only monitor specific projects, environments, or error levels).
  * **Requirement:** It must be able to extract relevant context from a Sentry alert, including:
      * Error message and type.
      * Stack trace (including file paths and line numbers).
      * Relevant tags and context (user ID, request ID, etc.).
      * Sentry issue URL.
  * **Requirement:** Implement a mechanism to avoid processing the same alert repeatedly (e.g., using Sentry issue IDs and internal state).

**6.2. Initial Slack Notification**

  * **Requirement:** Upon detecting a new, actionable Sentry alert, the agent must post a message to a designated Slack channel (e.g., `#engineering-alerts`).
  * **Requirement:** The message must include:
      * A clear indication that Sentrypede is handling the issue.
      * The Sentry error message.
      * A link to the Sentry issue.
      * (Optional) The engineer/team potentially responsible (if determinable).

**6.3. Code Checkout & Branching**

  * **Requirement:** The agent must have secure access to the Dovetail.com GitHub repositories.
  * **Requirement:** It must pull the latest version of the `master` (or designated default) branch of the relevant repository into a secure, isolated working directory.
  * **Requirement:** It must create a new branch for the fix. The branch name should be descriptive and reference the Sentry issue (e.g., `sentrypede/fix-sentry-<issue-id>`).

**6.4. AI-Powered Bug Fixing (Google Gemini)**

  * **Requirement:** The agent must connect to the Google Gemini API securely.
  * **Requirement:** It must construct a detailed prompt for Gemini, including:
      * The Sentry error message and stack trace.
      * The source code (relevant snippets or files identified from the stack trace).
      * Clear instructions to identify the bug and suggest a code fix, adhering to Dovetail's coding standards.
      * Instructions to *only* modify the code necessary to fix the bug.
  * **Requirement:** It must parse the response from Gemini and apply the suggested code changes to the files in the working directory.
  * **Requirement:** Implement error handling for cases where Gemini cannot provide a fix or the provided fix is invalid.

**6.5. Unit Test Generation**

  * **Requirement:** After applying the code fix, the agent must construct another prompt for Gemini.
  * **Requirement:** This prompt will include:
      * The Sentry error details (as context for what broke).
      * The original (buggy) code snippet.
      * The new (fixed) code snippet.
      * Instructions to generate a *new* unit test using our testing framework (specify framework, e.g., Jest, Vitest) that:
          * Fails with the *original* code.
          * Passes with the *new* code.
          * Follows Dovetail's unit testing best practices.
  * **Requirement:** The agent must add the generated unit test to the appropriate test file or create a new one.
  * **Requirement:** The agent must run *all* unit tests (or at least those relevant to the changed code) within the working directory to ensure the fix doesn't introduce regressions and the new test passes. If tests fail, the process should halt (or attempt a retry/different fix).

**6.6. GitHub Pull Request Creation**

  * **Requirement:** If the fix is applied and tests pass, the agent must commit the changes (code fix and new unit test) to the created branch.
  * **Requirement:** It must push the branch to the GitHub repository.
  * **Requirement:** It must create a Pull Request (PR) targeting the `master` (or default) branch.
  * **Requirement:** The PR description must be automatically generated and include:
      * A title like "Sentrypede: Fix for Sentry \<issue-id\> - \<Error Message\>".
      * A link to the Sentry issue.
      * A summary of the bug.
      * A description of the fix applied by Gemini.
      * A note that this PR was auto-generated and requires human review.
      * (Optional) Assign relevant reviewers or teams based on code ownership.

**6.7. Final Slack Notification**

  * **Requirement:** After successfully creating the PR, the agent must post an update to the *original* Slack thread (or the designated channel).
  * **Requirement:** The message must include:
      * Confirmation that Sentrypede has attempted a fix.
      * A link to the newly created GitHub PR.
      * A call to action for engineers to review the PR.
  * **Requirement:** If the agent *failed* at any step (couldn't fix, tests failed), it should post a message indicating the failure and the reason, linking back to the Sentry issue for manual investigation.

**7. Technical Requirements**

  * **Language/Platform:** TypeScript on Node.js.
  * **Testing:** High unit test coverage for the agent's own codebase.
  * **Deployment:** Designed to run within a single Docker container or as an AWS Lambda function. Consider Lambda's execution time limits (max 15 mins) and temporary storage limitations, especially for code checkouts and running tests. A container (e.g., on Fargate or ECS) might offer more flexibility.
  * **Local Debugging:** The agent must be easily runnable in a local terminal session. This requires clear instructions, environment variable management (e.g., using `.env` files), and potentially mock services for Sentry/Slack/GitHub/Gemini.
  * **Code Structure:** Maintain a clean, modular architecture.
  * **CI/CD Pipeline:** Automated testing and deployment via GitHub Actions:
      * **Continuous Integration:** Automated testing on every push and pull request
      * **Multi-version Testing:** Support for Node.js 18.x and 20.x
      * **Code Quality:** ESLint enforcement and code coverage reporting
      * **Security Scanning:** Automated vulnerability scanning with npm audit and Snyk
      * **Docker Support:** Automated Docker image building and pushing
      * **Release Automation:** Tag-based releases with automatic versioning
      * **Dependency Management:** Automated dependency updates via Dependabot

**8. Non-Functional Requirements**

  * **Security:** All API keys and credentials (Sentry, Slack, GitHub, Gemini) must be managed securely (e.g., using AWS Secrets Manager or environment variables, not hardcoded). Code checkout and execution must happen in an isolated, secure environment.
  * **Reliability:** The agent should be resilient to transient errors (e.g., network issues) and include retry mechanisms where appropriate. It needs robust error handling and logging.
  * **Observability:** Implement comprehensive logging to track the agent's progress for each Sentry alert it processes. Integrate with Dovetail's existing logging/monitoring systems if possible.
  * **Scalability:** While initially designed for a single instance, consider how it might handle an increased volume of Sentry alerts if deployed as a single agent. Lambda offers inherent scalability, but container deployments need planning.
  * **Configurability:** Key parameters (Sentry projects/environments, Slack channel, GitHub repo/branch, Gemini model) should be configurable without code changes.

**9. Assumptions & Dependencies**

  * Availability and access to Sentry, Slack, GitHub, and Google Gemini APIs.
  * The Dovetail codebase is hosted on GitHub.
  * The codebase has a standardized structure and a working unit test suite that can be run via a command-line script.
  * Sufficient permissions will be granted for API tokens (Sentry read, Slack post, GitHub read/write/PR, Gemini execute).
  * Access to an AWS environment for deployment (Lambda or container orchestration).

**10. Open Questions & Risks**

  * **Gemini Accuracy:** How reliable will Gemini be at fixing bugs and writing tests? What's the plan if it consistently produces incorrect or suboptimal code? (Requires human oversight initially).
  * **Complexity Handling:** Can the agent handle complex bugs involving multiple files or intricate logic? (Likely not initially; focus on simpler, pattern-based errors).
  * **Test Environment:** How will we ensure the test environment within the agent accurately reflects the production environment to validate fixes and tests? (Containerization helps, but differences can exist).
  * **Cost:** What are the anticipated costs associated with Gemini API calls, Sentry API usage, and AWS compute/storage?
  * **Security:** Running code (especially tests) in an automated environment carries risks. How do we mitigate potential security vulnerabilities?
  * **Infinite Loops/Thrashing:** How do we prevent the bot from trying to fix the same "unfixable" bug repeatedly or getting stuck in a loop?

**11. Success Metrics**

  * Number of Sentry alerts automatically processed by Sentrypede per week/month.
  * Number of successful PRs generated and merged.
  * Reduction in the median time-to-resolution (TTR) for Sentry alerts handled by the bot.
  * Percentage decrease in manual engineering time spent on Sentry bugs.
  * Developer feedback and satisfaction scores.

**12. Future Enhancements (Post-MVP)**

  * Support for multiple programming languages/repositories.
  * More sophisticated Sentry alert filtering and prioritization.
  * Interactive Slack features (e.g., approve/reject a fix attempt from Slack).
  * Integration with CI/CD to run tests on the actual CI infrastructure.
  * Learning capabilities – improving Gemini prompts based on previously successful/failed fixes.
  * Handling more complex bugs or providing deeper analysis.