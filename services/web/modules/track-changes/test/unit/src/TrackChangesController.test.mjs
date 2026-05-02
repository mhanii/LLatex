import { beforeEach, describe, expect, it, vi } from 'vitest'
import MockResponse from '../../../../../test/unit/src/helpers/MockResponse.mjs'

const PROJECT_ID = 'aaa000000000000000000001'
const DOC_ID = 'bbb000000000000000000001'
const USER_ID = 'ccc000000000000000000001'
const CHANGE_IDS = ['ddd000000000000000000001', 'ddd000000000000000000002']

let SessionManager
let CollaboratorsHandler
let DocumentUpdaterHandler
let EditorRealTimeController
let Project
let TrackChangesController

describe('TrackChangesController', function () {
  beforeEach(async function () {
    vi.resetModules()

    vi.doMock(
      '../../../../../app/src/Features/Authentication/SessionManager.mjs',
      () => ({
        default: { getLoggedInUserId: vi.fn().mockReturnValue(USER_ID) },
      })
    )

    vi.doMock(
      '../../../../../app/src/Features/Collaborators/CollaboratorsHandler.mjs',
      () => ({
        default: {
          promises: {
            convertTrackChangesToExplicitFormat: vi
              .fn()
              .mockResolvedValue({ [USER_ID]: true }),
          },
        },
      })
    )

    vi.doMock(
      '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs',
      () => ({
        default: {
          promises: {
            getProjectRanges: vi.fn().mockResolvedValue([
              {
                id: DOC_ID,
                ranges: {
                  changes: [{ id: CHANGE_IDS[0] }],
                  comments: [],
                },
              },
            ]),
            acceptChanges: vi
              .fn()
              .mockResolvedValue({ acceptedChangeIds: [CHANGE_IDS[0]] }),
            rejectChanges: vi
              .fn()
              .mockResolvedValue({ rejectedChangeIds: CHANGE_IDS }),
          },
        },
      })
    )

    vi.doMock(
      '../../../../../app/src/Features/Editor/EditorRealTimeController.mjs',
      () => ({
        default: { emitToRoom: vi.fn() },
      })
    )

    vi.doMock('../../../../../app/src/models/Project.mjs', () => ({
      Project: {
        findOne: vi.fn(),
        updateOne: vi.fn(),
      },
    }))

    ;({ default: SessionManager } = await import(
      '../../../../../app/src/Features/Authentication/SessionManager.mjs'
    ))
    ;({ default: CollaboratorsHandler } = await import(
      '../../../../../app/src/Features/Collaborators/CollaboratorsHandler.mjs'
    ))
    ;({ default: DocumentUpdaterHandler } = await import(
      '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
    ))
    ;({ default: EditorRealTimeController } = await import(
      '../../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
    ))
    ;({ Project } = await import('../../../../../app/src/models/Project.mjs'))
    ;({ default: TrackChangesController } = await import(
      '../../../app/src/TrackChangesController.mjs'
    ))

    mockProject({ track_changes: false })
    mockProjectUpdate()
  })

  function makeReq(body = {}, params = {}) {
    return {
      params: {
        project_id: PROJECT_ID,
        doc_id: DOC_ID,
        ...params,
      },
      body,
      session: {},
    }
  }

  function makeRes() {
    return new MockResponse(vi)
  }

  function mockProject(project) {
    Project.findOne.mockReturnValue({
      lean: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(project),
      }),
    })
  }

  function mockProjectUpdate(result = {}) {
    Project.updateOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(result),
    })
  }

  describe('getProjectRanges', function () {
    it('returns ranges from document-updater', async function () {
      const res = makeRes()

      await TrackChangesController.getProjectRanges(
        makeReq(),
        res,
        vi.fn()
      )

      expect(DocumentUpdaterHandler.promises.getProjectRanges).toHaveBeenCalledWith(
        PROJECT_ID
      )
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual([
        {
          id: DOC_ID,
          ranges: {
            changes: [{ id: CHANGE_IDS[0] }],
            comments: [],
          },
        },
      ])
    })
  })

  describe('saveTrackChanges', function () {
    it('saves a global boolean track-changes state', async function () {
      const res = makeRes()

      await TrackChangesController.saveTrackChanges(
        makeReq({ on: true }),
        res,
        vi.fn()
      )

      expect(Project.updateOne).toHaveBeenCalledWith(
        { _id: PROJECT_ID },
        { $set: { track_changes: true } }
      )
      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledWith(
        PROJECT_ID,
        'toggle-track-changes',
        true
      )
      expect(res.statusCode).toBe(204)
    })

    it('merges per-user track-changes state into an existing object', async function () {
      mockProject({ track_changes: { other_user: true } })

      await TrackChangesController.saveTrackChanges(
        makeReq({ on_for: { [USER_ID]: true } }),
        makeRes(),
        vi.fn()
      )

      expect(Project.updateOne).toHaveBeenCalledWith(
        { _id: PROJECT_ID },
        {
          $set: {
            track_changes: {
              other_user: true,
              [USER_ID]: true,
            },
          },
        }
      )
    })

    it('converts global true state before saving a per-user change', async function () {
      mockProject({ track_changes: true })

      await TrackChangesController.saveTrackChanges(
        makeReq({ on_for: { other_user: false } }),
        makeRes(),
        vi.fn()
      )

      expect(
        CollaboratorsHandler.promises.convertTrackChangesToExplicitFormat
      ).toHaveBeenCalledWith(PROJECT_ID, true)
      expect(Project.updateOne).toHaveBeenCalledWith(
        { _id: PROJECT_ID },
        {
          $set: {
            track_changes: {
              [USER_ID]: true,
              other_user: false,
            },
          },
        }
      )
    })

    it('saves guest track-changes state', async function () {
      await TrackChangesController.saveTrackChanges(
        makeReq({ on_for_guests: true }),
        makeRes(),
        vi.fn()
      )

      expect(Project.updateOne).toHaveBeenCalledWith(
        { _id: PROJECT_ID },
        { $set: { track_changes: { __guests__: true } } }
      )
    })

    it('returns 400 when no track-changes state is provided', async function () {
      const res = makeRes()

      await TrackChangesController.saveTrackChanges(makeReq(), res, vi.fn())

      expect(res.statusCode).toBe(400)
      expect(Project.updateOne).not.toHaveBeenCalled()
    })

    it('returns 400 when on_for values are not booleans', async function () {
      const res = makeRes()

      await TrackChangesController.saveTrackChanges(
        makeReq({ on_for: { [USER_ID]: 'yes' } }),
        res,
        vi.fn()
      )

      expect(res.statusCode).toBe(400)
      expect(Project.updateOne).not.toHaveBeenCalled()
    })
  })

  describe('acceptChanges', function () {
    it('accepts changes and emits confirmed accept-changes to the project room', async function () {
      const res = makeRes()

      await TrackChangesController.acceptChanges(
        makeReq({ change_ids: CHANGE_IDS }),
        res,
        vi.fn()
      )

      expect(SessionManager.getLoggedInUserId).toHaveBeenCalledWith({})
      expect(DocumentUpdaterHandler.promises.acceptChanges).toHaveBeenCalledWith(
        PROJECT_ID,
        DOC_ID,
        CHANGE_IDS,
        USER_ID
      )
      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledWith(
        PROJECT_ID,
        'accept-changes',
        DOC_ID,
        [CHANGE_IDS[0]]
      )
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({
        acceptedChangeIds: [CHANGE_IDS[0]],
      })
    })

    it('returns 400 when change_ids is not an array', async function () {
      const res = makeRes()

      await TrackChangesController.acceptChanges(
        makeReq({ change_ids: CHANGE_IDS[0] }),
        res,
        vi.fn()
      )

      expect(res.statusCode).toBe(400)
      expect(SessionManager.getLoggedInUserId).not.toHaveBeenCalled()
      expect(DocumentUpdaterHandler.promises.acceptChanges).not.toHaveBeenCalled()
    })
  })

  describe('rejectChanges', function () {
    it('rejects changes and returns rejected change ids', async function () {
      const res = makeRes()

      await TrackChangesController.rejectChanges(
        makeReq({ change_ids: CHANGE_IDS }),
        res,
        vi.fn()
      )

      expect(DocumentUpdaterHandler.promises.rejectChanges).toHaveBeenCalledWith(
        PROJECT_ID,
        DOC_ID,
        CHANGE_IDS,
        USER_ID
      )
      expect(EditorRealTimeController.emitToRoom).toHaveBeenCalledWith(
        PROJECT_ID,
        'reject-changes',
        DOC_ID,
        CHANGE_IDS
      )
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ rejectedChangeIds: CHANGE_IDS })
    })

    it('returns 400 when change_ids is not an array', async function () {
      const res = makeRes()

      await TrackChangesController.rejectChanges(
        makeReq({ change_ids: CHANGE_IDS[0] }),
        res,
        vi.fn()
      )

      expect(res.statusCode).toBe(400)
      expect(SessionManager.getLoggedInUserId).not.toHaveBeenCalled()
      expect(DocumentUpdaterHandler.promises.rejectChanges).not.toHaveBeenCalled()
    })
  })
})
