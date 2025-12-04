import { AuthManager } from '../auth/authManager'
import { Browser, Page } from 'playwright'
import logger from '../utils/logger'
import { GetNoteDetail, NoteDetail } from './noteDetail'

export interface Note {
  title: string
  content: string
  tags: string[]
  url: string
  author: string
  likes?: number
  collects?: number
  comments?: number
}

export interface Comment {
  author: string
  content: string
  likes: number
  time: string
}

export class RedNoteTools {
  private authManager: AuthManager
  private browser: Browser | null = null
  private page: Page | null = null

  constructor() {
    logger.info('Initializing RedNoteTools')
    this.authManager = new AuthManager()
  }

  async initialize(checkLogin: boolean = true): Promise<void> {
    logger.info('Initializing browser and page')
    this.browser = await this.authManager.getBrowser()
    if (!this.browser) {
      throw new Error('Failed to initialize browser')
    }

    try {
      this.page = await this.browser.newPage()

      // Load cookies if available
      const cookies = await this.authManager.getCookies()
      if (cookies.length > 0) {
        logger.info(`Loading ${cookies.length} cookies`)
        await this.page.context().addCookies(cookies)
      }

      if (checkLogin) {
        // Check login status
        logger.info('Checking login status')
        await this.page.goto('https://www.xiaohongshu.com')
        const isLoggedIn = await this.page.evaluate(() => {
          const sidebarUser = document.querySelector('.user.side-bar-component .channel')
          return sidebarUser?.textContent?.trim() === '我'
        })

        // If not logged in, perform login
        if (!isLoggedIn) {
          logger.error('Not logged in, please login first')
          throw new Error('Not logged in')
        }
        logger.info('Login status verified')
      }
    } catch (error) {
      // 初始化过程中出错，确保清理资源
      await this.cleanup()
      throw error
    }
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up browser resources')
    try {
      if (this.page) {
        await this.page.close().catch(err => logger.error('Error closing page:', err))
        this.page = null
      }

      if (this.browser) {
        await this.browser.close().catch(err => logger.error('Error closing browser:', err))
        this.browser = null
      }
    } catch (error) {
      logger.error('Error during cleanup:', error)
    } finally {
      this.page = null
      this.browser = null
    }
  }

  extractRedBookUrl(shareText: string): string {
    // 匹配 http://xhslink.com/ 开头的链接
    const xhslinkRegex = /(https?:\/\/xhslink\.com\/[a-zA-Z0-9\/]+)/i
    const xhslinkMatch = shareText.match(xhslinkRegex)

    if (xhslinkMatch && xhslinkMatch[1]) {
      return xhslinkMatch[1]
    }

    // 匹配 https://www.xiaohongshu.com/ 开头的链接
    const xiaohongshuRegex = /(https?:\/\/(?:www\.)?xiaohongshu\.com\/[^，\s]+)/i
    const xiaohongshuMatch = shareText.match(xiaohongshuRegex)

    if (xiaohongshuMatch && xiaohongshuMatch[1]) {
      return xiaohongshuMatch[1]
    }

    return shareText
  }

  async searchNotes(keywords: string, limit: number = 10): Promise<Note[]> {
    logger.info(`Searching notes with keywords: ${keywords}, limit: ${limit}`)

    const maxRetries = 3
    let retryCount = 0

    while (retryCount < maxRetries) {
      try {
        await this.initialize(false)
        if (!this.page) throw new Error('Page not initialized')

        // Navigate to home page first
        logger.info('Navigating to home page')
        await this.page.goto('https://www.xiaohongshu.com')

        // Make sure we are actually logged in before proceeding
        const isLoggedIn = await this.page.evaluate(() => {
          const sidebarUser = document.querySelector('.user.side-bar-component .channel')
          return sidebarUser?.textContent?.trim() === '我'
        })
        if (!isLoggedIn) {
          throw new Error('Not logged in. Please run rednote-mcp init to refresh your session.')
        }

        // Wait for search input
        logger.info('Waiting for search input')
        const searchInputSelector = 'input#search-input, input.search-input'
        await this.page.waitForSelector(searchInputSelector, { timeout: 10000 })

        // Type keywords with random delay to simulate human behavior
        logger.info('Typing keywords...')
        const input = await this.page.$(searchInputSelector)
        if (input) {
          await input.click()
          await this.page.waitForTimeout(Math.random() * 500 + 200) // Initial delay

          for (const char of keywords) {
            await this.page.keyboard.type(char)
            await this.page.waitForTimeout(Math.random() * 200 + 50) // Typing delay
          }

          await this.page.waitForTimeout(Math.random() * 500 + 200) // Pre-enter delay

          // Press Enter and wait for navigation
          logger.info('Pressing Enter to search')

          const maxSearchRetries = 3

          for (let attempt = 1; attempt <= maxSearchRetries; attempt++) {
            try {
              await this.page.keyboard.press('Enter')

              // Wait for URL to change to search result
              await this.page.waitForURL(url => url.href.includes('search_result'), {
                timeout: 5000,
                waitUntil: 'domcontentloaded'
              })
              break
            } catch (e) {
              logger.warn(`Search attempt ${attempt} failed to trigger navigation, retrying...`)
              if (attempt === maxSearchRetries) {
                throw new Error('Failed to trigger search navigation')
              }
              await this.randomDelay(1, 2)
            }
          }
        } else {
          throw new Error('Search input not found')
        }
        // Wait for results to load
        logger.info('Waiting for search results')
        try {
          // Try multiple possible selectors for the feed container or items
          await this.page.waitForSelector('.content-container > section, .feeds-container > section', {
            timeout: 10000
          })
        } catch (e) {
          logger.warn('Timeout waiting for search results selector, proceeding to extraction anyway')
          // Check for error message even if selector times out
          const errorText = await this.page.evaluate(() => document.body.innerText)
          if (errorText.includes('出错了') || errorText.includes('网络错误')) {
            throw new Error('Detected error page')
          }
          // If it's just a timeout and no explicit error text, we might still proceed
          // but re-throwing the original error might be better if the page is truly not ready.
          // For now, we'll just log and proceed as per the instruction's implied flow.
        }

        await this.randomDelay(1, 2)

        // Get all note items
        let noteItems = await this.page.$$('.feeds-container .note-item')
        logger.info(`Found ${noteItems.length} note items`)

        if (noteItems.length === 0) {
          throw new Error('No results found, might need retry')
        }

        const notes: Note[] = []

        // Process each note
        for (let i = 0; i < Math.min(noteItems.length, limit); i++) {
          logger.info(`Processing note ${i + 1}/${Math.min(noteItems.length, limit)}`)
          try {
            // Re-query items to avoid stale element reference
            noteItems = await this.page.$$('.feeds-container .note-item')
            if (!noteItems[i]) continue

            // Click on the note cover to open detail
            await noteItems[i].$eval('a.cover.mask.ld', (el: HTMLElement) => el.click())

            // Wait for the note page to load
            logger.info('Waiting for note page to load')
            // Wait for note scroller or container
            await this.page.waitForSelector('.note-scroller', {
              timeout: 30000
            })

            await this.randomDelay(0.5, 1.5)

            // Extract note content
            const note = await this.page.evaluate(() => {
              // Try to find the container
              const scroller = document.querySelector('.note-scroller')
              const container = document.querySelector('#noteContainer') || scroller

              if (!container) return null

              // Get title - try multiple selectors
              let title = ''
              const titleEl = container.querySelector('#detail-title') ||
                container.querySelector('.title') ||
                container.querySelector('[class*="title"]')
              if (titleEl) {
                title = titleEl.textContent?.trim() || ''
              } else {
                // Fallback: try to find the first significant text element
                // This is risky but better than nothing if structure changed
                const firstText = container.querySelector('div')?.textContent?.trim()
                if (firstText && firstText.length < 100) title = firstText
              }

              // Get content
              let content = ''
              const contentEl = container.querySelector('#detail-desc .note-text') ||
                container.querySelector('.desc') ||
                container.querySelector('[class*="desc"]') ||
                container.querySelector('.content')
              if (contentEl) {
                content = contentEl.textContent?.trim() || ''
              }

              // Get author info
              let author = ''
              const authorEl = container.querySelector('.author-wrapper .username') ||
                container.querySelector('.name span') ||
                container.querySelector('.name') ||
                document.querySelector('.author-container .name') // Fallback to document search if outside container
              if (authorEl) {
                author = authorEl.textContent?.trim() || ''
              }

              // Get interaction counts
              // These might be outside the scroller in the overlay
              // Try to find engage bar globally or near the container
              const engageBar = document.querySelector('.engage-bar-style') ||
                document.querySelector('.interaction-container') ||
                document.querySelector('.note-interaction')

              const likesElement = engageBar?.querySelector('.like-wrapper .count') || engageBar?.querySelector('.like .count')
              const likes = parseInt(likesElement?.textContent?.replace(/[^\d]/g, '') || '0')

              const collectElement = engageBar?.querySelector('.collect-wrapper .count') || engageBar?.querySelector('.collect .count')
              const collects = parseInt(collectElement?.textContent?.replace(/[^\d]/g, '') || '0')

              const commentsElement = engageBar?.querySelector('.chat-wrapper .count') || engageBar?.querySelector('.comment .count')
              const comments = parseInt(commentsElement?.textContent?.replace(/[^\d]/g, '') || '0')

              return {
                title,
                content,
                url: window.location.href,
                author,
                likes,
                collects,
                comments
              }
            })

            if (note) {
              logger.info(`Extracted note: ${note.title}`)
              notes.push(note as Note)
            }

            // Add random delay before closing
            await this.randomDelay(0.5, 1)

            // Close note by clicking the close button
            // Close button might be outside scroller
            const closeButton = await this.page.$('.close-circle') || await this.page.$('.close-mask') || await this.page.$('.close')
            if (closeButton) {
              logger.info('Closing note dialog')
              await closeButton.click()

              // Wait for note dialog to disappear
              const noteDialog = await this.page.$('.note-scroller')
              if (noteDialog) {
                await this.page.waitForSelector('.note-scroller', {
                  state: 'detached',
                  timeout: 30000
                })
              }
            }
          } catch (error) {
            logger.error(`Error processing note ${i + 1}:`, error)
            const closeButton = await this.page.$('.close-circle') || await this.page.$('.close-mask') || await this.page.$('.close')
            if (closeButton) {
              logger.info('Attempting to close note dialog after error')
              await closeButton.click()

              // Wait for note dialog to disappear
              const noteDialog = await this.page.$('.note-scroller')
              if (noteDialog) {
                await this.page.waitForSelector('.note-scroller', {
                  state: 'detached',
                  timeout: 30000
                })
              }
            }
          } finally {
            // Add random delay before next note
            await this.randomDelay(0.5, 1.5)
          }
        }

        logger.info(`Successfully processed ${notes.length} notes`)
        await this.cleanup()
        return notes

      } catch (error) {
        logger.error(`Search attempt ${retryCount + 1} failed:`, error)
        retryCount++
        await this.cleanup()

        if (retryCount >= maxRetries) {
          logger.error('Max retries reached, giving up')
          throw error
        }

        logger.info(`Retrying search (attempt ${retryCount + 1})...`)
        await this.randomDelay(2, 5) // Wait before retry
      }
    }

    return []
  }

  async getNoteContent(url: string): Promise<NoteDetail> {
    logger.info(`Getting note content for URL: ${url}`)
    try {
      await this.initialize()
      if (!this.page) throw new Error('Page not initialized')

      const actualURL = this.extractRedBookUrl(url)
      await this.page.goto(actualURL)
      let note = await GetNoteDetail(this.page)
      note.url = url
      logger.info(`Successfully extracted note: ${note.title}`)
      return note
    } catch (error) {
      logger.error('Error getting note content:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  async getNoteComments(url: string): Promise<Comment[]> {
    logger.info(`Getting comments for URL: ${url}`)
    try {
      await this.initialize()
      if (!this.page) throw new Error('Page not initialized')

      await this.page.goto(url)

      // Wait for comments to load
      logger.info('Waiting for comments to load')
      await this.page.waitForSelector('[role="dialog"] [role="list"]')

      // Extract comments
      const comments = await this.page.evaluate(() => {
        const items = document.querySelectorAll('[role="dialog"] [role="list"] [role="listitem"]')
        const results: Comment[] = []

        items.forEach((item) => {
          const author = item.querySelector('[data-testid="user-name"]')?.textContent?.trim() || ''
          const content = item.querySelector('[data-testid="comment-content"]')?.textContent?.trim() || ''
          const likes = parseInt(item.querySelector('[data-testid="likes-count"]')?.textContent || '0')
          const time = item.querySelector('time')?.textContent?.trim() || ''

          results.push({ author, content, likes, time })
        })

        return results
      })

      logger.info(`Successfully extracted ${comments.length} comments`)
      return comments
    } catch (error) {
      logger.error('Error getting note comments:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  /**
   * Wait for a random duration between min and max seconds
   * @param min Minimum seconds to wait
   * @param max Maximum seconds to wait
   */
  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.random() * (max - min) + min
    logger.debug(`Adding random delay of ${delay.toFixed(2)} seconds`)
    await new Promise((resolve) => setTimeout(resolve, delay * 1000))
  }
}
