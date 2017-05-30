/**
 * Module for configurable control interface. Makes use of an HTML5
 * canvas to paint controls and handle multi-touch events.
 *
 * @module controls
 */
import { constrain } from './utils'

/**************************************************************
 * ControlManager Implementation                              *
 **************************************************************/

const _touchOwners = { }

function convertTouch (touch) {
  return {
    identifier: touch.identifier,
    clientX: Math.round(touch.clientX - ControlManager.canvas.offsetLeft),
    clientY: Math.round(touch.clientY - ControlManager.canvas.offsetTop),
    force: touch.force
  }
}

function doAdd (touch) {
  if (typeof touch.identifier === 'undefined') touch.identifier = 'mouse'
  touch = convertTouch(touch)

  // loop through controls and see if one captures the touch //
  for (const controlName in ControlManager.controls) {
    const control = ControlManager.controls[controlName]
    if (control.matchesTouch(touch)) {
      _touchOwners[touch.identifier] = control
      control.setTouch(touch)
      ControlManager.update()
      break
    }
  }
  // console.log('touchStart', touch, touch.identifier)
}

function doUpdate (touch) {
  if (typeof touch.identifier === 'undefined') touch.identifier = 'mouse'
  const control = _touchOwners[touch.identifier]
  if (!control) return
  control.setTouch(convertTouch(touch))
  // console.log('touchMove', touch, touch.identifier)
  ControlManager.update()
}

function doRemove (touch) {
  if (typeof touch.identifier === 'undefined') touch.identifier = 'mouse'
  const control = _touchOwners[touch.identifier]
  if (!control) return
  control.setTouch(null)
  delete _touchOwners[touch.identifier]
  // console.log('touchEnd', touch, touch.identifier)
  ControlManager.update()
}

const FRAME_RATE = 35
let _oldWidth
let _oldHeight
export const ControlManager = {
  canvas: null,
  ctx: null,
  intervalID: null,
  controls: { },
  onupdate: null,

  setCanvas (canvas) {
    function handleTouches (e, handler) {
      // prevent scrolling and mouse fallthrough on desktop //
      e.preventDefault()
      // loop through touches //
      for (let i = 0; i < e.changedTouches.length; i++) {
        handler(e.changedTouches[i])
      }
    }

    canvas.addEventListener('touchstart', (e) => handleTouches(e, doAdd), false)
    canvas.addEventListener('touchmove', (e) => handleTouches(e, doUpdate), false)
    canvas.addEventListener('touchend', (e) => handleTouches(e, doRemove), false)

    canvas.addEventListener('mousedown', doAdd, false)
    canvas.addEventListener('mousemove', doUpdate, false)
    canvas.addEventListener('mouseup', doRemove, false)

    ControlManager.canvas = canvas
    ControlManager.ctx = canvas.getContext('2d')
  },

  start () {
    // handle default values of button groups //
    const buttonGroups = { }
    for (const controlName in ControlManager.controls) {
      const control = ControlManager.controls[controlName]
      if (control instanceof Button && control.groupName) {
        const { groupName } = control
        if (buttonGroups[groupName]) {
          buttonGroups[groupName].push(control)
        } else {
          buttonGroups[groupName] = [ control ]
        }
      }
    }
    for (const groupName in buttonGroups) {
      const buttons = buttonGroups[groupName]
      // if user has not set a default pressed button, select first //
      if (!buttons.some(button => button.pressed)) {
        buttons[0].pressed = true
      }
    }

    // start painting //
    ControlManager.intervalID = setInterval(
      () => ControlManager.draw(),
      1000 / FRAME_RATE
    )
  },

  stop () {
    if (ControlManager.intervalID) {
      clearInterval(ControlManager.intervalID)
    }
  },

  update () {
    const { onupdate } = ControlManager
    if (typeof onupdate === 'function') {
      onupdate()
    }
  },

  draw () {
    const { canvas, ctx, controls } = ControlManager

    // check for canvas resize //
    const resized = (canvas.width !== _oldWidth || canvas.height !== _oldHeight)
    if (resized) {
      _oldWidth = canvas.width
      _oldHeight = canvas.height
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // loop through controls //
    for (const controlName in controls) {
      const control = controls[controlName]
      if (resized) control.pixelCache = null
      control.draw(ctx)
    }
  }
}

function addControl (name, control) {
  if (ControlManager.controls[name]) {
    throw new Error(`Control already exists: ${name}`)
  }
  ControlManager.controls[name] = control
}

function convertToPixels (dim, value) {
  // determine the reference dimension based on name //
  let reference
  switch (dim) {
    case 'y':
    case 'height':
      reference = ControlManager.canvas.height
      break
    default:
      reference = ControlManager.canvas.width
      break
  }

  // handle based on type //
  switch (typeof value) {
    case 'number':
      // if a fraction, assume a percent //
      if (value > 0 && value < 1.0) {
        value *= 100
      }
      return Math.round(value * reference / 100)
    case 'string':
      const matches = value.match(/^([0-9]+)([^0-9]*)$/)
      if (matches) {
        const [ , num, unit ] = matches
        value = parseInt(num)
        switch (unit) {
          case '%':
          case '':
            return Math.round(value * reference / 100)
          case 'px':
            return value
        }
      }
      // fallthrough //
    default:
      return null
  }
}

/**************************************************************
 * Control / Graphics Classes                                 *
 **************************************************************/

/**
 * Base class for all UI controls.
 */
export class Control {
  constructor (name) {
    this.name = name || `control${++Control.count}`

    this.touch = null
    this.pixelCache = null
    addControl(name, this)
  }

  /**
   * Implemented by subclasses to determine if they match
   * the specified touch.
   */
  matchesTouch (touch) {
    return false
  }

  /**
   * Update the touch captured by this control.
   */
  setTouch (touch) {
    this.touch = touch
  }

  /**
   * Get the control dimensions converted to pixels relative
   * to the current canvas size. This cached for performance reasons.
   */
  getPixelDimensions () {
    if (this.pixelCache) return this.pixelCache
    const dimensions = this.getDimensions()
    const pixels = {}
    for (const dimName in dimensions) {
      pixels[dimName] = convertToPixels(dimName, dimensions[dimName])
    }
    return (this.pixelCache = pixels)
  }
}
Control.count = 0

/**
 * A joystick
 */
export class Joystick extends Control {
  constructor (name) {
    super(name)
    this.position = { x: 0, y: 0 }
    this.radius = 10
    this.sticky = false
    this.style = 'white'
    // initial values //
    this.x = 0
    this.y = 0
  }

  getDimensions () {
    return { x: this.position.x, y: this.position.y, r: this.radius }
  }

  matchesTouch (touch) {
    const { clientX, clientY } = touch
    const { x, y, r } = this.getPixelDimensions()

    const dx = (x - clientX)
    const dy = (y - clientY)
    return Math.sqrt(dx * dx + dy * dy) <= r
  }

  setTouch (touch) {
    super.setTouch(touch)
    if (touch) {
      const { x, y, r } = this.getPixelDimensions()
      this.x = constrain((x - touch.clientX) / r, -1.0, 1.0)
      this.y = constrain((y - touch.clientY) / r, -1.0, 1.0)
    } else if (!this.sticky) {
      this.x = 0.0
      this.y = 0.0
    }
  }

  draw (ctx) {
    const { x, y, r } = this.getPixelDimensions()
    const ir = Math.round(r / 3)

    ctx.beginPath()
    ctx.strokeStyle = (this.touch && this.touchedStyle) || this.style
    ctx.lineWidth = 5
    ctx.arc(x, y, ir, 0, Math.PI * 2, true)
    ctx.stroke()

    ctx.beginPath()
    ctx.strokeStyle = (this.touch && this.touchedStyle) || this.style
    ctx.lineWidth = 2
    ctx.arc(x, y, r, 0, Math.PI * 2, true)
    ctx.stroke()

    // paint the current touch //
    ctx.beginPath()
    ctx.strokeStyle = this.style
    ctx.arc(x - this.x * r, y - this.y * r, ir, 0, Math.PI * 2, true)
    ctx.stroke()

    ctx.beginPath()
    ctx.fillStyle = 'white'
    ctx.fillText(
      `${this.name}, x: ${this.x.toFixed(3)}, y: ${this.y.toFixed(3)}`,
      x - 50, y + r + 15
    )
  }
}

/**
 * A button
 */
export class Button extends Control {
  constructor (name) {
    super(name)
    this.position = { x: 0, y: 0 }
    this.radius = 10
    this.sticky = false
    this.groupName = null
    this.style = 'white'
    // initial value //
    this.pressed = false
  }

  getDimensions () {
    return { x: this.position.x, y: this.position.y, r: this.radius }
  }

  matchesTouch (touch) {
    const { clientX, clientY } = touch
    const { x, y, r } = this.getPixelDimensions()

    const dx = (x - clientX)
    const dy = (y - clientY)
    return Math.sqrt(dx * dx + dy * dy) <= r
  }

  setTouch (touch) {
    const lastState = !!this.touch
    console.log(this.sticky, this.touch, lastState, touch, this.pressed)
    super.setTouch(touch)
    if (this.sticky) {
      // only react to touchStart //
      if (touch && !lastState) {
        // are we part of a group //
        if (this.groupName) {
          // only react to changed values //
          if (!this.pressed) {
            // clear all others in group //
            for (const controlName in ControlManager.controls) {
              const control = ControlManager.controls[controlName]
              if (control instanceof Button && control.groupName === this.groupName) {
                control.pressed = false
              }
            }
            this.pressed = true
          }
        } else {
          // just toggle this button //
          this.pressed = !!(this.pressed ^ true)
        }
      }
    } else {
      this.pressed = !!touch
    }
  }

  draw (ctx) {
    const { x, y, r } = this.getPixelDimensions()

    ctx.beginPath()
    ctx.strokeStyle = this.style
    ctx.fillStyle = this.style
    ctx.lineWidth = 6
    ctx.arc(x, y, r, 0, Math.PI * 2, true)
    if (this.pressed) {
      ctx.fill()
    } else {
      ctx.stroke()
    }

    ctx.beginPath()
    ctx.fillStyle = 'white'
    ctx.fillText(
      `${this.name}, pressed: ${this.pressed}`,
      x - 50, y + r + 15
    )
  }
}

/**
 *  A slider. This is really shoddy algorithm design, and it only
 *  support strictly horizontal or vertical sliders. Major FIXME
 *  to come back and due to proper computation geometry.
 */
export class Slider extends Control {
  constructor (name) {
    super(name)
    this.position = { x: 0, y: 0 }
    this.radius = 10
    this.length = 30
    this.type = Slider.VERTICAL
    this.sticky = true
    this.style = 'white'
    // initial value //
    this.value = 0
  }

  getDimensions () {
    return {
      x: this.position.x,
      y: this.position.y,
      r: this.radius,
      l: this.length
    }
  }

  setTouch (touch) {
    super.setTouch(touch)
    if (touch) {
      const { l, xa, ya } = this.getHelperDimensions()
      if (this.type === Slider.HORIZONTAL) {
        this.value = constrain((xa - touch.clientX) / l, 0.0, 1.0)
      } else {
        this.value = constrain((ya - touch.clientY) / l, 0.0, 1.0)
      }
    } else if (!this.sticky) {
      this.value = 0
    }
  }

  getHelperDimensions () {
    const { x, y, r, l } = this.getPixelDimensions()
    if (this.type === Slider.HORIZONTAL) {
      return {
        x,
        x1: x,
        x2: x + l,
        xa: x + l,
        y,
        y1: y - r,
        y2: y + r,
        ya: y,
        r,
        l
      }
    } else {
      return {
        x,
        x1: x - r,
        x2: x + r,
        xa: x,
        y,
        y1: y,
        y2: y + l,
        ya: y + l,
        r,
        l
      }
    }
  }

  matchesTouch (touch) {
    const { clientX, clientY } = touch
    const { x, y, r, x1, y1, x2, y2, xa, ya } = this.getHelperDimensions()

    // check if in the end circles //
    const dx = (x - clientX)
    const dy = (y - clientY)
    if (Math.sqrt(dx * dx + dy * dy) <= r) return true
    const dxa = (xa - clientX)
    const dya = (ya - clientY)
    if (Math.sqrt(dxa * dxa + dya * dya) <= r) return true

    // check if in the rectangle //
    return (clientX >= x1) && (clientX <= x2) && (clientY >= y1) && (clientY <= y2)
  }

  draw (ctx) {
    const { x, y, r, l, x1, y1, x2, y2, xa, ya } = this.getHelperDimensions()

    ctx.beginPath()
    ctx.strokeStyle = this.style
    ctx.lineWidth = 2
    if (this.type === Slider.HORIZONTAL) {
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y1)
      ctx.arc(xa, ya, r, Math.PI * 3 / 2, Math.PI / 2, false)
      ctx.moveTo(x2, y2)
      ctx.lineTo(x1, y2)
      ctx.arc(x, y, r, Math.PI / 2, Math.PI * 3 / 2, false)
    } else {
      ctx.arc(x, y, r, Math.PI, Math.PI * 2, false)
      ctx.moveTo(x2, y1)
      ctx.lineTo(x2, y2)
      ctx.arc(xa, ya, r, 0, Math.PI, false)
      ctx.moveTo(x1, y2)
      ctx.lineTo(x1, y1)
    }
    ctx.stroke()

    // paint the current value //
    ctx.beginPath()
    if (this.type === Slider.HORIZONTAL) {
      ctx.arc(xa - (this.value * l), y, r - 4, 0, Math.PI * 2, true)
    } else {
      ctx.arc(x, ya - (this.value * l), r - 4, 0, Math.PI * 2, true)
    }
    ctx.strokeStyle = this.style
    ctx.stroke()

    // paint debug text //
    ctx.beginPath()
    ctx.fillStyle = 'white'
    ctx.fillText(
      `${this.name}, value: ${this.value.toFixed(3)}`,
      xa - 50, ya + r + 15
    )
  }
}
Slider.HORIZONTAL = 'Horizontal'
Slider.VERTICAL = 'Vertical'