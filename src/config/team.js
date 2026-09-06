/**
 * Team/season configuration.
 *
 * Centralized here so swapping team, season, or Jira project is a
 * one-file change instead of hunting through resolvers/webhooks/services.
 */

export const JIRA_PROJECT_KEY = 'FW47';

export const JIRA_ISSUE_TYPES = {
  incident: 'Race Incident',
  task: 'Task'
};

// Driver roster: keyed by car number, used for both OpenF1 lookups
// (headshot/team colour) and Jira ticket labeling (name/acronym).
export const TEAM_DRIVERS = {
  23: {
    full_name: 'Alex Albon',
    acronym: 'ALB',
    team_name: 'Williams',
    team_colour: '37BEFF',
    headshot_url: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/A/ALEALB01_Alexander_Albon/alealb01.png.transform/2col/image.png'
  },
  55: {
    full_name: 'Carlos Sainz',
    acronym: 'SAI',
    team_name: 'Williams',
    team_colour: '37BEFF',
    headshot_url: 'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/C/CARSAI01_Carlos_Sainz/carsai01.png.transform/2col/image.png'
  }
};

export function getTeamDriver(driverNumber) {
  return TEAM_DRIVERS[driverNumber] || null;
}
