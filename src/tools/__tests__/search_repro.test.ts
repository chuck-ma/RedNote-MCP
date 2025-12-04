import { RedNoteTools } from '../rednoteTools'

describe('RedNoteTools Search Accuracy', () => {
    const runE2E = process.env.RUN_E2E_SEARCH === 'true'
    const maybeTest = runE2E ? test : test.skip

    let redNoteTools: RedNoteTools

    beforeEach(() => {
        redNoteTools = new RedNoteTools()
    })

    afterEach(async () => {
        await redNoteTools.cleanup()
    })

    maybeTest('searchNotes should return relevant results for "gemini3 pro"', async () => {
        const keywords = 'gemini3 pro'
        const limit = 5
        const notes = await redNoteTools.searchNotes(keywords, limit)

        expect(notes).toBeDefined()
        expect(notes.length).toBeGreaterThan(0)

        // Check if results are relevant (contain keywords in title or content)
        // Note: Fuzzy match because search results might not contain exact keyword in title
        const relevantNotes = notes.filter(note =>
            note.title.toLowerCase().includes('gemini') ||
            note.content.toLowerCase().includes('gemini')
        )

        console.log('Found notes:', notes.map(n => n.title))

        // We expect at least some relevant results
        expect(relevantNotes.length).toBeGreaterThan(0)
    }, 600000)
})
