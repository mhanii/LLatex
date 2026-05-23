import '../../../../../test/acceptance/src/helpers/InitApp.mjs'
import MockChatApi from '../../../../../test/acceptance/src/mocks/MockChatApi.mjs'
import MockClsiApi from '../../../../../test/acceptance/src/mocks/MockClsiApi.mjs'
import MockClsiNginxApi from '../../../../../test/acceptance/src/mocks/MockClsiNginxApi.mjs'
import MockDocstoreApi from '../../../../../test/acceptance/src/mocks/MockDocstoreApi.mjs'
import MockDocUpdaterApi from '../../../../../test/acceptance/src/mocks/MockDocUpdaterApi.mjs'
import MockNotificationsApi from '../../../../../test/acceptance/src/mocks/MockNotificationsApi.mjs'
import MockProjectHistoryApi from '../../../../../test/acceptance/src/mocks/MockProjectHistoryApi.mjs'
import MockSpellingApi from '../../../../../test/acceptance/src/mocks/MockSpellingApi.mjs'
import MockV1Api from '../../../../../test/acceptance/src/mocks/MockV1Api.mjs'
import MockV1HistoryApi from '../../../../../test/acceptance/src/mocks/MockV1HistoryApi.mjs'

const mockOpts = {
  debug: ['1', 'true', 'TRUE'].includes(process.env.DEBUG_MOCKS),
}

MockChatApi.initialize(23010, mockOpts)
MockClsiApi.initialize(23013, mockOpts)
MockClsiNginxApi.initialize(23080, mockOpts)
MockDocstoreApi.initialize(23016, mockOpts)
MockDocUpdaterApi.initialize(23003, mockOpts)
MockNotificationsApi.initialize(23042, mockOpts)
MockProjectHistoryApi.initialize(23054, mockOpts)
MockSpellingApi.initialize(23005, mockOpts)
MockV1Api.initialize(25000, mockOpts)
MockV1HistoryApi.initialize(23100, mockOpts)
