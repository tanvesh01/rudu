import { SVGProps } from 'react'

export function TablerHeading(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>{/* Icon from Tabler Icons by Paweł Kuna - https://github.com/tabler/tabler-icons/blob/master/LICENSE */}<path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 12h10M7 5v14M17 5v14m-2 0h4M15 5h4M5 19h4M5 5h4" /></svg>
  )
}
export default TablerHeading
