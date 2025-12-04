import { RedNoteTools, Note, Comment } from '../rednoteTools'

// npm run test
describe('RedNoteTools', () => {
  const runE2E = process.env.RUN_E2E_SEARCH === 'true'
  const maybeTest = runE2E ? test : test.skip
  let redNoteTools = new RedNoteTools()

  afterAll(async () => {
    await redNoteTools.cleanup()
  })

  maybeTest('getNoteContent 应该返回笔记详情', async () => {
    const url = '' // 需要替换为实际笔记URL

    const actualURL = redNoteTools.extractRedBookUrl(url)
    const note = await redNoteTools.getNoteContent(actualURL)
    console.log(note)
    expect(note).toBeDefined()
  }, 600000)
})
