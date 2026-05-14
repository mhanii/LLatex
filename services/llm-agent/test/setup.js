import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { ObjectId } from 'mongodb'

ObjectId.cacheHexString = true

chai.should()
chai.use(chaiAsPromised)
