import path from 'node:path';

const windowsPath = (value) => /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\');

function normalizeProject({ root, pythonDirectory }) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('Python PATH project root must be a non-empty string');
  }
  if (typeof pythonDirectory !== 'string' || pythonDirectory.length === 0) {
    throw new TypeError('Python PATH directory must be a non-empty relative path');
  }

  const pathApi = windowsPath(root) ? path.win32 : path.posix;
  if (pathApi.isAbsolute(pythonDirectory)) {
    throw new TypeError('Python PATH directory must be relative to its project root');
  }

  const projectRoot = pathApi.resolve(root);
  const pythonPath = pathApi.resolve(projectRoot, pythonDirectory);
  const relativePythonPath = pathApi.relative(projectRoot, pythonPath);
  if (relativePythonPath === '..' || relativePythonPath.startsWith(`..${pathApi.sep}`)) {
    throw new TypeError('Python PATH directory must stay inside its project root');
  }

  return { pathApi, projectRoot, pythonPath };
}

function isWithinProject(cwd, project) {
  if (typeof cwd !== 'string' || cwd.length === 0) return false;
  const relative = project.pathApi.relative(project.projectRoot, project.pathApi.resolve(cwd));
  return relative === '' || (relative !== '..'
    && !relative.startsWith(`..${project.pathApi.sep}`)
    && !project.pathApi.isAbsolute(relative));
}

function samePath(left, right, pathApi) {
  const normalize = (value) => {
    const resolved = pathApi.resolve(value);
    return pathApi === path.win32 ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

export function createProjectPythonPathPlugin({ projects = [], baselineEnv = process.env } = {}) {
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new TypeError('At least one Python PATH project must be configured');
  }
  const configuredProjects = projects.map(normalizeProject);

  return async () => ({
    'shell.env': async ({ cwd }, output) => {
      const project = configuredProjects.find((candidate) => isWithinProject(cwd, candidate));
      if (!project) return;

      const outputPathKey = Object.keys(output.env).find((key) => key.toLowerCase() === 'path');
      const baselinePathKey = Object.keys(baselineEnv).find((key) => key.toLowerCase() === 'path');
      const pathKey = outputPathKey ?? baselinePathKey;
      const outputPath = outputPathKey && output.env[outputPathKey];
      const baselinePath = baselinePathKey && baselineEnv[baselinePathKey];
      const currentPath = typeof outputPath === 'string' && outputPath.length > 0
        ? outputPath : baselinePath;
      if (!pathKey || typeof currentPath !== 'string' || currentPath.length === 0) return;

      const entries = currentPath.split(project.pathApi.delimiter).filter(Boolean);
      if (entries.some((entry) => samePath(entry, project.pythonPath, project.pathApi))) return;

      output.env[pathKey] = [project.pythonPath, currentPath].filter(Boolean)
        .join(project.pathApi.delimiter);
    },
  });
}
