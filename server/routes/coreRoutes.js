const registerCoreRoutes = ({ app, versionService }) => {
  app.get('/health', (_req, res) => res.status(200).send('OK'));
  app.get('/ready', (_req, res) => res.status(200).send('READY'));

  app.get('/api/version', (_req, res) => {
    res.json(versionService.getVersionInfo());
  });
};

export { registerCoreRoutes };
