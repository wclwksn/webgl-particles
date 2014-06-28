/*global Igloo */

function Particles(canvas, nparticles, size) {
    var igloo = this.igloo = new Igloo(canvas),
        gl = igloo.gl,
        maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE),
        w = canvas.width, h = canvas.height;
    gl.disable(gl.DEPTH_TEST);
    this.worldsize = new Float32Array([w, h]);
    this.scale = Math.floor(Math.pow(Particles.BASE, 2) / Math.max(w, h) / 3);

    /* Drawing parameters. */
    this.size = size || 5;
    this.color = new Float32Array([0.14, 0.62, 1, 1]);

    /* Simulation parameters. */
    this.running = false;
    this.gravity = new Float32Array([0, -0.05]);
    this.obstacles = [];

    function texture() {
        return igloo.texture(null, gl.RGBA, gl.CLAMP_TO_EDGE, gl.NEAREST);
    }

    this.programs = {
        update:  igloo.program('glsl/quad.vert', 'glsl/update.frag'),
        draw:    igloo.program('glsl/draw.vert', 'glsl/draw.frag'),
        flat:    igloo.program('glsl/quad.vert', 'glsl/flat.frag'),
        ocircle: igloo.program('glsl/ocircle.vert', 'glsl/ocircle.frag')
    };
    this.buffers = {
        quad: igloo.array(Igloo.QUAD2),
        indexes: igloo.array(),
        point: igloo.array(new Float32Array([0, 0]))
    };
    this.textures = {
        p0: texture(),
        p1: texture(),
        v0: texture(),
        v1: texture(),
        obstacles: igloo.texture().blank(w, h)
    };
    this.framebuffers = {
        step: igloo.framebuffer(),
        obstacles: igloo.framebuffer().attach(this.textures.obstacles)
    };

    this.setCount(nparticles, true);
    this.addObstacle([w / 2, h / 2], 32);
}

Particles.BASE = 255;

Particles.encode = function(value, scale) {
    var b = Particles.BASE;
    value = value * scale + b * b / 2;
    var pair = [
        Math.floor((value % b) / b * 255),
        Math.floor(Math.floor(value / b) / b * 255)
    ];
    return pair;
};

Particles.decode = function(pair, scale) {
    var b = Particles.BASE;
    return (((pair[0] / 255) * b +
             (pair[1] / 255) * b * b) - b * b / 2) / scale;
};

Particles.prototype.initTextures = function() {
    var tw = this.statesize[0], th = this.statesize[1],
        w = this.worldsize[0], h = this.worldsize[1],
        s = this.scale,
        rgbaP = new Uint8Array(tw * th * 4),
        rgbaV = new Uint8Array(tw * th * 4);
    for (var y = 0; y < th; y++) {
        for (var x = 0; x < tw; x++) {
            var i = y * tw * 4 + x * 4,
                px = Particles.encode(Math.random() * w, s),
                py = Particles.encode(Math.random() * h, s),
                vx = Particles.encode(Math.random() * 1.0 - 0.5, s),
                vy = Particles.encode(Math.random() * 20.0, s);
            rgbaP[i + 0] = px[0];
            rgbaP[i + 1] = px[1];
            rgbaP[i + 2] = py[0];
            rgbaP[i + 3] = py[1];
            rgbaV[i + 0] = vx[0];
            rgbaV[i + 1] = vx[1];
            rgbaV[i + 2] = vy[0];
            rgbaV[i + 3] = vy[1];
        }
    }
    this.textures.p0.set(rgbaP, tw, th);
    this.textures.v0.set(rgbaV, tw, th);
    this.textures.p1.blank(tw, th);
    this.textures.v1.blank(tw, th);
    return this;
};

Particles.prototype.initBuffers = function() {
    var tw = this.statesize[0], th = this.statesize[1],
        gl = this.igloo.gl,
        indexes = new Float32Array(tw * th * 2);
    for (var y = 0; y < th; y++) {
        for (var x = 0; x < tw; x++) {
            var i = y * tw * 2 + x * 2;
            indexes[i + 0] = x;
            indexes[i + 1] = y;
        }
    }
    this.buffers.indexes.update(indexes, gl.STATIC_DRAW);
    return this;
};

Particles.prototype.setCount = function(n) {
    var tw = Math.ceil(Math.sqrt(n)),
        th = Math.floor(Math.sqrt(n));
    this.statesize = new Float32Array([tw, th]);
    this.initTextures();
    this.initBuffers();
};

Particles.prototype.getCount = function() {
    return this.statesize[0] * this.statesize[1];
};

Particles.prototype.get = function() {
    var gl = this.igloo.gl;
    this.framebuffers.step.attach(this.textures.p0);
    var w = this.statesize[0], h = this.statesize[1],
        s = this.scale,
        rgba = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    var particles = [];
    for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
            var i = y * w * 4 + x * 4,
                px = Particles.decode([rgba[i + 0], rgba[i + 1]], s),
                py = Particles.decode([rgba[i + 2], rgba[i + 3]], s);
            particles.push({x: px, y: py});
        }
    }
    return particles;
};

Particles.prototype.swap = function() {
    var tmp = this.textures.p0;
    this.textures.p0 = this.textures.p1;
    this.textures.p1 = tmp;
    tmp = this.textures.v0;
    this.textures.v0 = this.textures.v1;
    this.textures.v1 = tmp;
    return this;
};

Particles.prototype.updateObstacles = function() {
    var gl = this.igloo.gl;
    this.framebuffers.obstacles.bind();
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.worldsize[0], this.worldsize[1]);
    gl.clearColor(0.5, 0.5, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (var i = 0; i < this.obstacles.length; i++) {
        var obstacle = this.obstacles[i];
        if (obstacle.enabled) {
            obstacle.program.use()
                .attrib('vert', obstacle.verts, 2)
                .uniform('position', new Float32Array(obstacle.position))
                .uniform('worldsize', this.worldsize)
                .uniform('size', obstacle.size)
                .draw(obstacle.mode, obstacle.length);
        }
    }
};

Particles.prototype.addObstacle = function(center, radius) {
    var igloo = this.igloo, gl = igloo.gl,
        w = this.worldsize[0], h = this.worldsize[1];
    var obstacle = {
        enabled: true,
        program: this.programs.ocircle,
        verts: this.buffers.point,
        position: center,
        size: radius,
        mode: gl.POINTS,
        length: 1
    };
    this.obstacles.push(obstacle);
    this.updateObstacles();
    return obstacle;
};

Particles.prototype.step = function() {
    var igloo = this.igloo, gl = igloo.gl;
    gl.disable(gl.BLEND);
    this.framebuffers.step.attach(this.textures.p1);
    this.textures.p0.bind(0);
    this.textures.v0.bind(1);
    this.textures.obstacles.bind(2);
    gl.viewport(0, 0, this.statesize[0], this.statesize[1]);
    this.programs.update.use()
        .attrib('quad', this.buffers.quad, 2)
        .uniformi('position', 0)
        .uniformi('velocity', 1)
        .uniformi('obstacles', 2)
        .uniform('scale', this.scale)
        .uniform('random', Math.random() * 2.0 - 1.0)
        .uniform('gravity', this.gravity)
        .uniform('worldsize', this.worldsize)
        .uniformi('derivative', 0)
        .draw(gl.TRIANGLE_STRIP, Igloo.QUAD2.length / 2);
    this.framebuffers.step.attach(this.textures.v1);
    this.programs.update
        .uniformi('derivative', 1)
        .uniform('random', Math.random() * 2.0 - 1.0)
        .draw(gl.TRIANGLE_STRIP, Igloo.QUAD2.length / 2);
    this.swap();
    return this;
};

Particles.prototype.draw = function() {
    var igloo = this.igloo, gl = igloo.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    igloo.defaultFramebuffer.bind();
    gl.viewport(0, 0, this.worldsize[0], this.worldsize[1]);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.textures.p0.bind(0);
    this.textures.v0.bind(1);
    this.programs.draw.use()
        .attrib('index', this.buffers.indexes, 2)
        .uniformi('positions', 0)
        .uniformi('velocities', 1)
        .uniform('statesize', this.statesize)
        .uniform('worldsize', this.worldsize)
        .uniform('size', this.size)
        .uniform('scale', this.scale)
        .uniform('color', this.color)
        .draw(gl.POINTS, this.statesize[0] * this.statesize[1]);
    this.textures.obstacles.bind(2);
    this.programs.flat.use()
        .attrib('quad', this.buffers.quad, 2)
        .uniformi('background', 2)
        .draw(gl.TRIANGLE_STRIP, Igloo.QUAD2.length / 2);
    return this;
};

Particles.prototype.frame = function() {
    window.requestAnimationFrame(function() {
        if (this.running) {
            this.step().draw().frame();
        }
    }.bind(this));
    return this;
};

Particles.prototype.start = function() {
    if (!this.running) {
        this.running = true;
        this.frame();
    }
    return this;
};

Particles.prototype.stop = function() {
    this.running = false;
    return this;
};
