/// <reference path="util.ts" />

namespace xsystem35 {
    export class ZoomManager {
        private canvas: HTMLCanvasElement;
        private zoomSelect: HTMLInputElement;
        private smoothingCheckbox: HTMLInputElement;

        constructor() {
            this.canvas = <HTMLCanvasElement>$('#canvas');
            this.zoomSelect = <HTMLInputElement>$('#zoom');
            this.zoomSelect.addEventListener('change', this.handleZoom.bind(this));
            this.zoomSelect.value = localStorage.getItem('zoom') || '1';
            this.smoothingCheckbox = <HTMLInputElement>$('#smoothing');
            this.smoothingCheckbox.addEventListener('change', this.handleSmoothing.bind(this));
            if (localStorage.getItem('smoothing') == 'false') {
                this.smoothingCheckbox.checked = false;
                this.handleSmoothing();
            }
        }

        handleZoom() {
            var value = this.zoomSelect.value;
            localStorage.setItem('zoom', value);
            var contentsStyle = $('.contents').style;
            if (value == 'fit') {
                contentsStyle.maxWidth = 'none';
                contentsStyle.width = this.canvas.style.width = '100%';
            } else {
                var ratio = Number(value);
                contentsStyle.maxWidth = 'none';
                contentsStyle.width = this.canvas.style.width = this.canvas.width * ratio + 'px';
            }
        }

        private handleSmoothing() {
            localStorage.setItem('smoothing', String(this.smoothingCheckbox.checked));
            if (this.smoothingCheckbox.checked)
                this.canvas.classList.remove('pixelated');
            else
                this.canvas.classList.add('pixelated');
        }
    }
}