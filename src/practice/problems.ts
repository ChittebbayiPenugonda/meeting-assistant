import type { Lang } from './runner'

export interface TestCase {
  args: string // JSON array of arguments, e.g. [[2,7,11,15], 9]
  expected: string // JSON value
}

/** How "expected" is compared with the returned value. */
export type Compare = 'exact' | 'unordered' | 'unordered-nested'

export interface Problem {
  id: string
  title: string
  difficulty: 'Easy' | 'Medium' | 'Hard' | ''
  description: string // markdown
  fn: Record<Lang, string>
  starter: Record<Lang, string>
  tests: TestCase[]
  compare: Compare
}

const t = (args: unknown[], expected: unknown): TestCase => ({
  args: JSON.stringify(args),
  expected: JSON.stringify(expected),
})

export const PROBLEMS: Problem[] = [
  {
    id: 'two-sum',
    title: 'Two Sum',
    difficulty: 'Easy',
    description: `Given an array of integers \`nums\` and an integer \`target\`, return the **indices** of the two numbers that add up to \`target\`.

Each input has exactly one solution, and you may not use the same element twice. Return the two indices in increasing order.

### Example 1
\`\`\`
Input: nums = [2, 7, 11, 15], target = 9
Output: [0, 1]
Explanation: nums[0] + nums[1] == 9
\`\`\`

### Example 2
\`\`\`
Input: nums = [3, 2, 4], target = 6
Output: [1, 2]
\`\`\`

### Constraints
- 2 ≤ nums.length ≤ 10⁴
- -10⁹ ≤ nums[i], target ≤ 10⁹
- Exactly one valid answer exists.

**Follow-up:** can you do better than O(n²)?`,
    fn: { python: 'two_sum', javascript: 'twoSum' },
    starter: {
      python: `def two_sum(nums, target):\n    pass\n`,
      javascript: `function twoSum(nums, target) {\n\n}\n`,
    },
    tests: [t([[2, 7, 11, 15], 9], [0, 1]), t([[3, 2, 4], 6], [1, 2]), t([[3, 3], 6], [0, 1]), t([[-1, -2, -3, -4, -5], -8], [2, 4])],
    compare: 'exact',
  },
  {
    id: 'valid-parentheses',
    title: 'Valid Parentheses',
    difficulty: 'Easy',
    description: `Given a string \`s\` containing only the characters \`()[]{}\`, return \`true\` if it is valid.

A string is valid when every opening bracket is closed by the same type of bracket, and brackets close in the correct order.

### Example 1
\`\`\`
Input: s = "()[]{}"
Output: true
\`\`\`

### Example 2
\`\`\`
Input: s = "(]"
Output: false
\`\`\`

### Example 3
\`\`\`
Input: s = "([)]"
Output: false
\`\`\`

### Constraints
- 1 ≤ s.length ≤ 10⁴`,
    fn: { python: 'is_valid', javascript: 'isValid' },
    starter: {
      python: `def is_valid(s):\n    pass\n`,
      javascript: `function isValid(s) {\n\n}\n`,
    },
    tests: [t(['()'], true), t(['()[]{}'], true), t(['(]'], false), t(['([)]'], false), t(['{[]}'], true), t(['(('], false)],
    compare: 'exact',
  },
  {
    id: 'longest-substring',
    title: 'Longest Substring Without Repeating Characters',
    difficulty: 'Medium',
    description: `Given a string \`s\`, return the length of the longest substring that contains no repeated characters.

### Example 1
\`\`\`
Input: s = "abcabcbb"
Output: 3
Explanation: "abc" has length 3.
\`\`\`

### Example 2
\`\`\`
Input: s = "bbbbb"
Output: 1
\`\`\`

### Example 3
\`\`\`
Input: s = "pwwkew"
Output: 3
Explanation: "wke". Note "pwke" is a subsequence, not a substring.
\`\`\`

### Constraints
- 0 ≤ s.length ≤ 5 × 10⁴`,
    fn: { python: 'length_of_longest_substring', javascript: 'lengthOfLongestSubstring' },
    starter: {
      python: `def length_of_longest_substring(s):\n    pass\n`,
      javascript: `function lengthOfLongestSubstring(s) {\n\n}\n`,
    },
    tests: [t(['abcabcbb'], 3), t(['bbbbb'], 1), t(['pwwkew'], 3), t([''], 0), t(['dvdf'], 3), t(['abba'], 2)],
    compare: 'exact',
  },
  {
    id: 'merge-intervals',
    title: 'Merge Intervals',
    difficulty: 'Medium',
    description: `Given a list of intervals where \`intervals[i] = [start, end]\`, merge all overlapping intervals and return the result sorted by start.

### Example 1
\`\`\`
Input: intervals = [[1,3],[2,6],[8,10],[15,18]]
Output: [[1,6],[8,10],[15,18]]
\`\`\`

### Example 2
\`\`\`
Input: intervals = [[1,4],[4,5]]
Output: [[1,5]]
Explanation: intervals that touch are merged.
\`\`\`

### Constraints
- 1 ≤ intervals.length ≤ 10⁴
- The input is not necessarily sorted.`,
    fn: { python: 'merge', javascript: 'merge' },
    starter: {
      python: `def merge(intervals):\n    pass\n`,
      javascript: `function merge(intervals) {\n\n}\n`,
    },
    tests: [
      t([[[1, 3], [2, 6], [8, 10], [15, 18]]], [[1, 6], [8, 10], [15, 18]]),
      t([[[1, 4], [4, 5]]], [[1, 5]]),
      t([[[1, 4], [0, 4]]], [[0, 4]]),
      t([[[1, 4], [2, 3]]], [[1, 4]]),
      t([[[5, 7]]], [[5, 7]]),
    ],
    compare: 'exact',
  },
  {
    id: 'stock',
    title: 'Best Time to Buy and Sell Stock',
    difficulty: 'Easy',
    description: `You're given an array \`prices\` where \`prices[i]\` is a stock's price on day \`i\`. Choose one day to buy and a **later** day to sell. Return the maximum profit, or \`0\` if no profit is possible.

### Example 1
\`\`\`
Input: prices = [7, 1, 5, 3, 6, 4]
Output: 5
Explanation: buy at 1 on day 1, sell at 6 on day 4.
\`\`\`

### Example 2
\`\`\`
Input: prices = [7, 6, 4, 3, 1]
Output: 0
\`\`\`

### Constraints
- 1 ≤ prices.length ≤ 10⁵`,
    fn: { python: 'max_profit', javascript: 'maxProfit' },
    starter: {
      python: `def max_profit(prices):\n    pass\n`,
      javascript: `function maxProfit(prices) {\n\n}\n`,
    },
    tests: [t([[7, 1, 5, 3, 6, 4]], 5), t([[7, 6, 4, 3, 1]], 0), t([[1, 2]], 1), t([[2, 4, 1]], 2), t([[3]], 0)],
    compare: 'exact',
  },
  {
    id: 'group-anagrams',
    title: 'Group Anagrams',
    difficulty: 'Medium',
    description: `Given an array of strings \`strs\`, group the anagrams together. Groups and the words inside them can be in any order.

### Example 1
\`\`\`
Input: strs = ["eat","tea","tan","ate","nat","bat"]
Output: [["bat"],["nat","tan"],["ate","eat","tea"]]
\`\`\`

### Example 2
\`\`\`
Input: strs = [""]
Output: [[""]]
\`\`\`

### Constraints
- 1 ≤ strs.length ≤ 10⁴
- Strings contain lowercase English letters.`,
    fn: { python: 'group_anagrams', javascript: 'groupAnagrams' },
    starter: {
      python: `def group_anagrams(strs):\n    pass\n`,
      javascript: `function groupAnagrams(strs) {\n\n}\n`,
    },
    tests: [
      t([['eat', 'tea', 'tan', 'ate', 'nat', 'bat']], [['bat'], ['nat', 'tan'], ['ate', 'eat', 'tea']]),
      t([['']], [['']]),
      t([['a']], [['a']]),
      t([['abc', 'bca', 'xyz']], [['abc', 'bca'], ['xyz']]),
    ],
    compare: 'unordered-nested',
  },
  {
    id: 'custom',
    title: 'Custom problem',
    difficulty: '',
    description: `Paste your problem statement here: click **Edit** above.

Set the function name and add test cases in the panel on the right. Arguments are a JSON array, for example \`[[1, 2, 3], 5]\` for \`f([1, 2, 3], 5)\`.`,
    fn: { python: 'solution', javascript: 'solution' },
    starter: {
      python: `def solution(*args):\n    pass\n`,
      javascript: `function solution(...args) {\n\n}\n`,
    },
    tests: [],
    compare: 'exact',
  },
]

// ---------- your edits, saved in the browser ----------

export interface ProblemEdits {
  description?: string
  fn?: Partial<Record<Lang, string>>
  tests?: TestCase[]
  compare?: Compare
}

const editsKey = (id: string) => `practice-pad.problem.${id}`

export function loadEdits(id: string): ProblemEdits {
  try {
    return JSON.parse(localStorage.getItem(editsKey(id)) || '{}')
  } catch {
    return {}
  }
}

export function saveEdits(id: string, e: ProblemEdits) {
  try {
    localStorage.setItem(editsKey(id), JSON.stringify(e))
  } catch {}
}

export function clearEdits(id: string) {
  try {
    localStorage.removeItem(editsKey(id))
  } catch {}
}

export function withEdits(p: Problem, e: ProblemEdits): Problem {
  return {
    ...p,
    description: e.description ?? p.description,
    fn: { ...p.fn, ...e.fn },
    tests: e.tests ?? p.tests,
    compare: e.compare ?? p.compare,
  }
}
