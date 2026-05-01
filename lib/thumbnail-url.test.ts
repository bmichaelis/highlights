import { describe, it, expect } from 'vitest'
import { thumbnailRouteUrl } from './thumbnail-url'

describe('thumbnailRouteUrl', () => {
  it('builds the route URL from the four ID parts', () => {
    expect(thumbnailRouteUrl('myorg', 'team-1', 'proj-2', 'drive-fid-3'))
      .toBe('/api/orgs/myorg/teams/team-1/projects/proj-2/thumbnail/drive-fid-3')
  })
})
