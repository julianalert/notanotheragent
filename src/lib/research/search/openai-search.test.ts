import { describe, expect, it } from 'vitest'
import { redditTitleFromUrl } from './openai-search'

describe('Reddit hits without a summary', () => {
  it('still say what the post is about: the title is in the URL', () => {
    expect(redditTitleFromUrl('https://www.reddit.com/r/InstagramMarketing/comments/1t5a8v7/new_content_creator_how_can_i_monetize_my_early/')).toBe(
      'new content creator how can i monetize my early',
    )
    expect(redditTitleFromUrl('https://old.reddit.com/r/Instagram/comments/1vptqlh/how_are_you_making_money_on_ig/?sort=new')).toBe('how are you making money on ig')
  })

  it('is empty for anything that is not a post', () => {
    expect(redditTitleFromUrl('https://www.reddit.com/r/InstagramMarketing/')).toBe('')
    expect(redditTitleFromUrl('https://www.linkedin.com/posts/someone_activity-1')).toBe('')
  })
})
