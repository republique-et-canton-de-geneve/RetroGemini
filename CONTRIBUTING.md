# Contributing to RetroGemini

Thank you for your interest in contributing to RetroGemini! This document provides guidelines and information for contributors.

## Code of Conduct

Please be respectful and constructive in all interactions. We aim to maintain a welcoming environment for everyone.

## How to Contribute

### Reporting Issues

- Check existing issues to avoid duplicates
- Use a clear, descriptive title
- Provide steps to reproduce for bugs
- Include browser/environment details when relevant

### Suggesting Features

- Open an issue with the "enhancement" label
- Describe the use case and expected behavior
- Consider how it fits with existing features

### Submitting Pull Requests

1. **Fork and Clone**
   ```bash
   git clone https://github.com/your-username/retrogemini.git
   cd retrogemini
   ```

2. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Set Up Development Environment**
   ```bash
   npm install
   npm run start  # Backend on port 3000
   npm run dev    # Frontend on port 5173 (separate terminal)
   ```

4. **Make Your Changes**
   - Follow the existing code style
   - Add comments for complex logic
   - Update documentation if needed

5. **Test Your Changes**
   - Verify the application works locally
   - Test in both development and production modes
   - Check Docker build if you modified Dockerfile

6. **Commit and Push**
   ```bash
   git add .
   git commit -m "feat: description of your change"
   git push origin feature/your-feature-name
   ```

7. **Open a Pull Request**
   - Provide a clear description of changes
   - Reference any related issues
   - Include screenshots for UI changes

## Development Guidelines

### Code Style

- **TypeScript**: Use strict typing where possible
- **React**: Functional components with hooks
- **CSS**: Tailwind utility classes
- **Formatting**: Follow the existing patterns in the codebase

### Commit Messages

Follow conventional commits format:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `chore:` Maintenance tasks

### Project Structure

- `App.tsx` - Main application component
- `components/` - React UI components
- `services/` - Client-side services (data, sync)
- `server.js` - Backend Express server
- `types.ts` - TypeScript interfaces
- `k8s/` - Kubernetes manifests

### Testing Changes

```bash
# Development mode
npm run dev

# Production build
npm run build
npm run start

# Docker
docker-compose up app
```

## Questions?

Open an issue with the "question" label, and we'll be happy to help!

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
