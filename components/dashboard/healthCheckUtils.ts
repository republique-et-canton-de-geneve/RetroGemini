import { HealthCheckSession } from '../../types';

export const groupHealthChecksByTemplate = (healthChecks: HealthCheckSession[]) => {
  const map = new Map<string, { templateName: string; templateId: string; checks: HealthCheckSession[] }>();

  healthChecks.forEach((healthCheck) => {
    const key = healthCheck.templateId || healthCheck.templateName;
    if (!map.has(key)) {
      map.set(key, { templateName: healthCheck.templateName, templateId: healthCheck.templateId, checks: [] });
    }
    map.get(key)!.checks.push(healthCheck);
  });

  return Array.from(map.values());
};
