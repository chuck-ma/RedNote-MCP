import { RedNoteTools } from '../rednoteTools'

describe('RedNoteTools Search', () => {
    const runE2E = process.env.RUN_E2E_SEARCH === 'true'
    const maybeTest = runE2E ? test : test.skip

    let redNoteTools: RedNoteTools

    beforeEach(() => {
        redNoteTools = new RedNoteTools()
    })

    afterEach(async () => {
        await redNoteTools.cleanup()
    })

    maybeTest('searchNotes should return results for "装修"', async () => {
        const keywords = '装修'
        const limit = 2
        const notes = await redNoteTools.searchNotes(keywords, limit)

        expect(notes).toBeDefined()
        expect(notes.length).toBeGreaterThan(0)
        expect(notes.length).toBeLessThanOrEqual(limit)

        notes.forEach(note => {
            expect(note.title).toBeDefined()
            expect(note.url).toBeDefined()
        })
    }, 600000) // Long timeout for browser interaction
})
