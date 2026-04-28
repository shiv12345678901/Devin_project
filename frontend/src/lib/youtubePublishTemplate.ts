export const YOUTUBE_TEMPLATE_KEY = 'textbro:youtube-publish-template:v1'

export const DEFAULT_YOUTUBE_TEMPLATE = `Title:
{exact_title}

Description:
Title: {title}

Hello friends, Welcome to "Nepal Top Educational Channel" Educated Nepal.
About this knowledgeable video: {title}

If you want to ask something, you can ask in the comment box below the video.
If you would like to see more videos like this, Subscribe to our channel by clicking the Bell Icon All along with our channel. Don’t ask to join.
If you find this video helpful, don’t forget to like this video.

📘 Class on our Channel:
Class - 7 | Class - 8 | Class - 9 | Class - 10 | Class - 11 | Class - 12
Math Questions, Social Questions, Science of all classes Questions, Nepali Questions, etc. will solve different types of problems.

🔖 Hashtags:
{hashtags}

🙏 Please don’t forget to Subscribe to our channel 👆️
🙏🙏 Thank you for watching this video 🙏
❤️❤️ Stay connected with us ❤️❤️

🔍 Updated Queries:
{updated_queries}

📌 Additional Queries:
{additional_queries}

🌐 Website Plug:
🚀🎉 Exciting News! Our Educational Website is NOW LIVE! 🌐📚
Access free notes, past papers, and quizzes for Classes 10, 11, and 12—all in one place! Whether you're prepping for exams or brushing up on subjects, we've got you covered. Start your learning journey with us today! 📖✨
Visit 👉 https://shivakafle1.com.np/
For Class {class_number}: https://shivakafle1.com.np/notes

For more details visit our website at shivakafle1.com.np

Tags:
{tags}`

export function readYoutubeTemplate(): string {
  if (typeof window === 'undefined') return DEFAULT_YOUTUBE_TEMPLATE
  return window.localStorage.getItem(YOUTUBE_TEMPLATE_KEY) ?? DEFAULT_YOUTUBE_TEMPLATE
}

export function writeYoutubeTemplate(template: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(YOUTUBE_TEMPLATE_KEY, template)
}
