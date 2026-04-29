import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('track-changes web module index', function () {
  let baseBuildProjectModelView
  let mockProjectEditorHandler

  const registerMocks = () => {
    vi.doMock('../../../app/src/TrackChangesRouter.mjs', () => ({
      default: {},
    }))

    vi.doMock(
      '../../../../../app/src/Features/Project/ProjectEditorHandler.mjs',
      () => ({
        default: mockProjectEditorHandler,
      })
    )
  }

  beforeEach(function () {
    vi.resetModules()

    baseBuildProjectModelView = vi.fn(project => ({
      features: {},
      trackChangesState: project.track_changes || false,
    }))

    mockProjectEditorHandler = {
      buildProjectModelView: baseBuildProjectModelView,
      trackChangesAvailable: false,
    }

    registerMocks()
  })

  it('patches buildProjectModelView only once if the module is evaluated repeatedly', async function () {
    await import('../../../index.mjs')
    const firstWrappedBuildProjectModelView =
      mockProjectEditorHandler.buildProjectModelView

    vi.resetModules()
    registerMocks()
    await import('../../../index.mjs')
    const secondWrappedBuildProjectModelView =
      mockProjectEditorHandler.buildProjectModelView

    expect(secondWrappedBuildProjectModelView).toBe(
      firstWrappedBuildProjectModelView
    )
    expect(mockProjectEditorHandler.trackChangesAvailable).toBe(true)

    const result = mockProjectEditorHandler.buildProjectModelView({
      track_changes: true,
    })

    expect(baseBuildProjectModelView).toHaveBeenCalledTimes(1)
    expect(result.features.trackChanges).toBe(true)
    expect(result.features.trackChangesVisible).toBe(true)
    expect(result.trackChangesState).toBe(true)
  })
})
