---
applyTo: "**"
---

Provide project context and coding guidelines that AI should follow when generating code, answering questions, or reviewing changes.

# JavaScript Project Guidelines

1. **Code Structure**

    - Organize code into modules and components.
    - Follow a consistent naming convention (e.g., camelCase for variables and functions, PascalCase for classes).
    - Use string concatenation for building strings instead of template literals.
    - Avoid using `var` for variable declarations; use `let` and `const` instead.
    - comments should be staged with Step1) ,Step2) etc.

2. **Documentation**

    - Use JSDoc comments for all public functions and classes.
    - Include examples in documentation where applicable.

3. **Error Handling**

    - Use try-catch blocks for asynchronous code.
    - Provide meaningful error messages and logging.

4. **Performance**

    - Optimize for performance where necessary (e.g., avoid unnecessary computations, use efficient data structures).
    - Profile and benchmark code to identify bottlenecks.
    - use separate threads for heavy computations.

5. **Security**

    - Validate and sanitize all user inputs.
    - Follow best practices for secure coding (e.g., avoid eval, use HTTPS).

6. **Version Control**
    - Use Git for version control.
    - Write clear and concise commit messages.
    - Create pull requests for code reviews.
