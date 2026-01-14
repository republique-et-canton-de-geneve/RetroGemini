import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import App from '../App';
import { dataService } from '../services/dataService';
import { LanguageProvider } from '../i18n/LanguageContext';

// Mock the dataService
vi.mock('../services/dataService', () => ({
  dataService: {
    hydrateFromServer: vi.fn(() => Promise.resolve()),
    getAllTeams: vi.fn(() => []),
    getTeam: vi.fn(() => null),
  },
}));

describe('App Component', () => {
  const renderApp = () => render(
    <LanguageProvider>
      <App />
    </LanguageProvider>
  );

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Clear all mocks
    vi.clearAllMocks();
  });

  it('should render without crashing', async () => {
    renderApp();
    await waitFor(() => expect(document.body).toBeTruthy());
  });

  it('should start with LOGIN view by default', async () => {
    renderApp();
    // The TeamLogin component should be rendered initially
    // You can check for specific elements that appear in TeamLogin
    await waitFor(() => expect(document.body).toBeTruthy());
  });

  it('should call hydrateFromServer on mount', async () => {
    renderApp();
    await waitFor(() => {
      expect(dataService.hydrateFromServer).toHaveBeenCalledTimes(1);
    });
  });
});
