export function thumbnailRouteUrl(
  orgSlug: string,
  teamId: string,
  projectId: string,
  driveFileId: string,
): string {
  return `/api/orgs/${orgSlug}/teams/${teamId}/projects/${projectId}/thumbnail/${driveFileId}`
}
